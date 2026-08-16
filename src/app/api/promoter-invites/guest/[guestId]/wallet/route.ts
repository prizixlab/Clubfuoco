import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import { nightPassDates } from '@/lib/wallet/expiry'
import {
  passThemeRow, resolvePassTheme, passImages, promoterForGuest,
  promoterDisplayName, HOUSE_THEME,
} from '@/lib/wallet/pass-theme'

// Apple Wallet pass for a promoter-invite claim. Mirrors
// /api/bookings/[id]/wallet — same cert envs — but the primary field is the
// invited guest's NAME (per spec) instead of the venue.
//
// This is the one pass a promoter can brand: the colours, the wordmark and the
// organisation name come from their theme (see src/lib/wallet/pass-theme.ts).
// The bundle is still signed with OUR Pass Type ID certificate — there is only
// one — so the back of the pass says where it came from regardless of what the
// front looks like.

const CONFIGURED =
  !!process.env.APPLE_PASS_TYPE_ID &&
  !!process.env.APPLE_TEAM_ID &&
  !!process.env.APPLE_WWDR_PEM &&
  !!process.env.APPLE_SIGNER_CERT_PEM &&
  !!process.env.APPLE_SIGNER_KEY_PEM

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params

  if (!CONFIGURED) {
    return NextResponse.json(
      { error: 'Apple Wallet not configured yet' },
      { status: 503 }
    )
  }

  const sb = await createServiceClient()
  const { data: guest, error } = await sb
    .from('promoter_guests')
    .select(`
      id, full_name, plus_ones,
      allocation:promoter_allocations (
        id,
        night:promoter_nights (
          id, title, night_date, open_time, close_time,
          location_name, address,
          club:clubs ( id, name, address )
        )
      )
    `)
    .eq('id', guestId)
    .single()

  const allocation = (guest as any)?.allocation
  const night = Array.isArray(allocation) ? allocation[0]?.night : allocation?.night
  const nightRow = Array.isArray(night) ? night[0] : night
  if (error || !nightRow) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }
  const club = Array.isArray(nightRow.club) ? nightRow.club[0] : nightRow.club
  const clubName = club?.name ?? nightRow.location_name ?? 'Club Fuoco'
  const address = club?.address ?? nightRow.address ?? 'Barcelona'

  const eventDate = new Date(nightRow.night_date + 'T00:00:00')
  const dateStr = eventDate.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const partySize = 1 + (guest.plus_ones ?? 0)
  const hoursStr =
    nightRow.open_time && nightRow.close_time
      ? `${nightRow.open_time.slice(0, 5)} – ${nightRow.close_time.slice(0, 5)}`
      : null

  // The promoter who invited this guest owns the branding. No theme row (the
  // common case) resolves to the house palette, so this is a no-op for anyone
  // who has never opened the screen.
  const promoterId = await promoterForGuest(sb, guestId)
  const themeRow = promoterId ? await passThemeRow(sb, promoterId) : HOUSE_THEME
  const theme = resolvePassTheme(themeRow)
  const brandName = promoterId ? await promoterDisplayName(sb, promoterId) : 'Club Fuoco'

  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       `invite-${guest.id}`,
    // Relevant on the night, filed under "Expired Passes" the next morning.
    ...nightPassDates(nightRow.night_date),
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    // Shown on lock-screen notifications, so it should read as whoever the
    // guest thinks invited them.
    organizationName:   brandName,
    description:        `${nightRow.title ?? clubName} guestlist`,
    foregroundColor:    theme.foregroundColor,
    backgroundColor:    theme.backgroundColor,
    labelColor:         theme.labelColor,
    // Omitted entirely when a logo image is set — PassKit draws both if given
    // both, which reads as a mistake rather than a brand.
    ...(theme.logoText ? { logoText: theme.logoText } : {}),
    eventTicket: {
      // Spec: invitee's NAME is the primary field — this is the
      // single most useful piece of info for the bouncer + the invitee.
      primaryFields: [
        { key: 'guest', label: 'GUEST', value: guest.full_name },
      ],
      secondaryFields: [
        { key: 'venue', label: 'VENUE', value: clubName },
        { key: 'date',  label: 'DATE',  value: dateStr },
      ],
      auxiliaryFields: [
        { key: 'party', label: partySize > 1 ? 'GUESTS' : 'GUEST', value: String(partySize) },
        ...(hoursStr ? [{ key: 'hours', label: 'HOURS', value: hoursStr }] : []),
      ],
      backFields: [
        { key: 'event',   label: 'NIGHT',    value: nightRow.title ?? clubName },
        { key: 'address', label: 'LOCATION', value: address },
        { key: 'list',    label: 'LIST',     value: 'Promoter guestlist · Comp entry' },
        { key: 'terms',   label: 'TERMS',
          value: 'Non-transferable. Present at door. Subject to capacity and venue policy.' },
        // Provenance stays on the pass even when the front is entirely the
        // promoter's — the guest should be able to find out who actually
        // issued the thing in their Wallet.
        { key: 'issuer',  label: 'ISSUED BY',
          value: theme.isHouse ? 'Club Fuoco' : `${brandName} · issued via Club Fuoco` },
      ],
    },
    barcodes: [
      {
        message:         `fuoco-invite:${guest.id}`,
        format:          'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
    barcode: {
      message:         `fuoco-invite:${guest.id}`,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    },
  }

  // All six image slots come from the promoter or none do — see passImages.
  const images = await passImages(themeRow)

  try {
    const pass = new PKPass(
      {
        'pass.json': Buffer.from(JSON.stringify(passJson)),
        ...images,
      },
      {
        wwdr:                Buffer.from(process.env.APPLE_WWDR_PEM!,        'base64'),
        signerCert:          Buffer.from(process.env.APPLE_SIGNER_CERT_PEM!, 'base64'),
        signerKey:           Buffer.from(process.env.APPLE_SIGNER_KEY_PEM!,  'base64'),
        signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASS!,
      }
    )

    const buf = pass.getAsBuffer()
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="fuoco-invite-${guest.id}.pkpass"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err: any) {
    console.error('[invite-wallet] pass generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate pass' }, { status: 500 })
  }
}
