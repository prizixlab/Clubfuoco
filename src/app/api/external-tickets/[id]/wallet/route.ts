import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import { nightPassDates } from '@/lib/wallet/expiry'
import { passThemeRow, resolvePassTheme, passImages, promoterDisplayName, HOUSE_THEME } from '@/lib/wallet/pass-theme'

// GET /api/external-tickets/<id>/wallet — Apple Wallet pass for a ticket
// bought in the app from a supplier's own system (Fourvenues).
//
// The barcode is the SUPPLIER's QR (`qr_payload`), not one of ours: the door
// scans it with Fourvenues, exactly as it would the PDF Fourvenues emails.
// The front is the supplier promoter's pass theme (HypeList's purple and
// wordmark), the same branding their promoter-invite passes get; the back
// still says it was issued via Club Fuoco.
//
// Owner only (Bearer): the QR is a door credential. No QR yet (the inbox
// hasn't filed Fourvenues' email) → 409, the app keeps showing "getting your
// ticket".

const CONFIGURED =
  !!process.env.APPLE_PASS_TYPE_ID &&
  !!process.env.APPLE_TEAM_ID &&
  !!process.env.APPLE_WWDR_PEM &&
  !!process.env.APPLE_SIGNER_CERT_PEM &&
  !!process.env.APPLE_SIGNER_KEY_PEM

/** Before nights carried their seller: Fourvenues was HypeList's alone. */
const LEGACY_BRAND: Record<string, string> = { fourvenues: 'hypelist' }

type Ticket = {
  id: string; user_id: string; provider: string; event_code: string
  event_name: string | null; venue: string | null; address: string | null
  night: string; doors: string | null; closes: string | null
  product_name: string | null; settle: string; heads: number | null
  qr_payload: string | null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!CONFIGURED) {
    return NextResponse.json({ error: 'Apple Wallet not configured yet' }, { status: 503 })
  }

  const sb = await createServiceClient()
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: u } = await sb.auth.getUser(bearer)
  if (!u.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await sb
    .from('external_tickets')
    .select('id, user_id, provider, event_code, event_name, venue, address, night, doors, closes, product_name, settle, heads, qr_payload')
    .eq('id', id)
    .maybeSingle()
  const t = data as Ticket | null
  if (!t || t.user_id !== u.user.id) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  if (!t.qr_payload) {
    return NextResponse.json({ error: 'Your ticket is still on its way' }, { status: 409 })
  }

  // The promoter whose channel sold it owns the front of the pass: the
  // account that owns the night with this Fourvenues code (agentbox files
  // each brand's nights under its own account), else the legacy seller.
  const { data: night } = await sb.from('promoter_nights')
    .select('created_by').eq('fourvenues_code', t.event_code).limit(1).maybeSingle()
  let promoterId = (night as { created_by: string | null } | null)?.created_by ?? null
  if (!promoterId && LEGACY_BRAND[t.provider]) {
    const { data: brand } = await sb.from('partner_brands')
      .select('owner_user_id').eq('key', LEGACY_BRAND[t.provider]).maybeSingle()
    promoterId = (brand as { owner_user_id: string | null } | null)?.owner_user_id ?? null
  }
  const themeRow = promoterId ? await passThemeRow(sb, promoterId) : HOUSE_THEME
  const theme = resolvePassTheme(themeRow)
  const brandName = promoterId ? await promoterDisplayName(sb, promoterId) : 'Club Fuoco'
  const passLogoText = theme.logoText ?? (theme.isHouse || themeRow.logo_1x_url ? null : brandName)

  const eventName = t.event_name ?? t.venue ?? 'Club night'
  const dateStr = new Date(t.night + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const heads = Math.max(1, t.heads ?? 1)
  const entry = t.settle === 'table' ? 'VIP table'
    : t.settle === 'free' ? 'Guestlist'
    : t.settle === 'door' ? 'Pay at the door' : 'Ticket'
  const hours = t.doors ? (t.closes ? `${t.doors} – ${t.closes}` : t.doors) : null
  const barcode = { message: t.qr_payload, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1', altText: t.qr_payload }

  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       `ext-${t.id}`,
    ...nightPassDates(t.night),
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   theme.isHouse ? 'Club Fuoco' : brandName,
    description:        `${eventName} — ${entry}`,
    foregroundColor:    theme.foregroundColor,
    backgroundColor:    theme.backgroundColor,
    labelColor:         theme.labelColor,
    ...(passLogoText ? { logoText: passLogoText } : {}),
    eventTicket: {
      primaryFields: [{ key: 'event', label: entry.toUpperCase(), value: eventName }],
      secondaryFields: [
        { key: 'venue', label: 'VENUE', value: t.venue ?? '—' },
        { key: 'date',  label: 'DATE',  value: dateStr },
      ],
      auxiliaryFields: [
        { key: 'guests', label: heads > 1 ? 'GUESTS' : 'GUEST', value: String(heads) },
        ...(hours ? [{ key: 'hours', label: 'HOURS', value: hours }] : []),
      ],
      backFields: [
        ...(t.product_name ? [{ key: 'product', label: 'ENTRY', value: t.product_name }] : []),
        ...(t.address ? [{ key: 'address', label: 'LOCATION', value: t.address }] : []),
        { key: 'code',   label: 'TICKET CODE', value: t.qr_payload },
        { key: 'terms',  label: 'TERMS',
          value: 'Non-transferable. Show this QR at the door. Subject to capacity and venue policy.' },
        { key: 'issuer', label: 'ISSUED BY',
          value: theme.isHouse ? 'Club Fuoco' : `${brandName} · issued via Club Fuoco` },
      ],
    },
    barcodes: [barcode],
    barcode,
  }

  const images = await passImages(themeRow, { isHouse: theme.isHouse })
  try {
    const pass = new PKPass(
      { 'pass.json': Buffer.from(JSON.stringify(passJson)), ...images },
      {
        wwdr:                Buffer.from(process.env.APPLE_WWDR_PEM!,        'base64'),
        signerCert:          Buffer.from(process.env.APPLE_SIGNER_CERT_PEM!, 'base64'),
        signerKey:           Buffer.from(process.env.APPLE_SIGNER_KEY_PEM!,  'base64'),
        signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASS!,
      },
    )
    return new NextResponse(pass.getAsBuffer() as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="ticket-${t.id}.pkpass"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (e) {
    console.error('[external-ticket-wallet] pass generation failed:', e)
    return NextResponse.json({ error: 'Failed to generate pass' }, { status: 500 })
  }
}
