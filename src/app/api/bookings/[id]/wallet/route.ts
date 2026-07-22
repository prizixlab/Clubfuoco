import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import { nightPassDates } from '@/lib/wallet/expiry'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import { RUMBALIST_OFFERS } from '@/lib/rumbalist-offers'

// Apple Wallet pass generation
// Required env vars (all cert values are base64-encoded PEM):
//   APPLE_PASS_TYPE_ID      — e.g. pass.com.clubfuoco.ticket
//   APPLE_TEAM_ID           — your 10-char Apple Team ID
//   APPLE_WWDR_PEM          — Apple WWDR G4 certificate (base64-encoded)
//   APPLE_SIGNER_CERT_PEM   — your Pass Type ID certificate (base64-encoded)
//   APPLE_SIGNER_KEY_PEM    — private key for the cert (base64-encoded)
//   APPLE_SIGNER_KEY_PASS   — passphrase for the key (optional)

type SB = Awaited<ReturnType<typeof createServiceClient>>

/** The supplier stamped on this booking, or null. Never throws — a pass must
 *  still generate if the brand row or the column is missing. */
async function brandForBooking(sb: SB, brandId: string | null | undefined) {
  if (!brandId) return null
  try {
    const { data } = await sb.from('partner_brands').select('*').eq('id', brandId).maybeSingle()
    if (!data) return null
    const r = data as Record<string, unknown>
    return { name: String(r.name ?? ''), color: (r.color as string) ?? null, logo_url: (r.logo_url as string) ?? null }
  } catch { return null }
}

/** "#RRGGBB" → "rgb(r, g, b)". PassKit rejects hex. */
function hexToPassRgb(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/**
 * The supplier's logo bytes for the pass logo slot.
 *
 * Fetched from the brand's own logo_url rather than a per-supplier file
 * checked into the repo, so onboarding a supplier stays a portal action and
 * never a deploy. Bounded and best-effort: a slow or broken logo falls back to
 * the Club Fuoco mark instead of failing the pass.
 */
async function fetchBrandLogo(url: string | null): Promise<Buffer | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), cache: 'no-store' })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('png')) return null    // PassKit needs PNG; SVG renders blank
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && buf.length < 1_500_000 ? buf : null
  } catch { return null }
}

/**
 * Apple's logo slot is at most 160x50 POINTS. Wallet derives points from the
 * pixel size of the file it picks, so an oversized image is drawn oversized —
 * a 640x130 hosted mark lands in logo@2x.png as 320x65pt, double the box, and
 * squeezes logoText off the pass.
 *
 * Hosted marks are whatever the supplier uploaded, so fit each slot here
 * rather than trusting the source dimensions. Contain, never enlarge: a small
 * logo stays small instead of being blown up into mush.
 */
async function fitLogo(buf: Buffer, scale: 1 | 2): Promise<Buffer> {
  return sharp(buf)
    // 'inside', not 'contain': no transparent padding, so a square mark still
    // sits flush left in the slot instead of floating in a 160-wide canvas.
    .resize({
      width: 160 * scale, height: 50 * scale,
      fit: 'inside', withoutEnlargement: true,
    })
    .png()
    .toBuffer()
}

const CONFIGURED =
  !!process.env.APPLE_PASS_TYPE_ID &&
  !!process.env.APPLE_TEAM_ID &&
  !!process.env.APPLE_WWDR_PEM &&
  !!process.env.APPLE_SIGNER_CERT_PEM &&
  !!process.env.APPLE_SIGNER_KEY_PEM

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!CONFIGURED) {
    return NextResponse.json(
      { error: 'Apple Wallet not configured yet' },
      { status: 503 }
    )
  }

  const supabase = await createServiceClient()
  // select('*') for the booking so brand_id can be absent (pre-migration rows
  // and pre-migration databases both read as "no supplier recorded").
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`*, clubs (id, name, address, neighborhood)`)
    .eq('id', id)
    .single()

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }
  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'Booking is cancelled' }, { status: 400 })
  }

  const club     = (booking as any).clubs
  const clubName = club?.name ?? 'Club Fuoco'
  const address  = club?.address ?? 'Barcelona'

  const eventDate = new Date(booking.booking_date)
  const dateStr   = eventDate.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // Who supplied this booking, for the pass's branding.
  //
  // Preferred source is bookings.brand_id, stamped at booking time. Falling
  // back to "is this club in RUMBALIST_OFFERS" was safe only while Rumba was
  // the sole supplier; now that several suppliers cover the same venues, that
  // guess would print a Rumba pass on another supplier's guestlist. So the
  // fallback is only used for rows booked before attribution existed.
  const brand = await brandForBooking(supabase, (booking as { brand_id?: string | null }).brand_id)
  const isRumbalist = !brand
    && booking.club_id != null && booking.club_id in RUMBALIST_OFFERS

  // Fetched before the pass JSON because logoText depends on whether a
  // supplier mark actually lands in the logo slot — a brand whose logo fails
  // to load falls back to the Club Fuoco mark and still wants the text.
  const brandLogo = brand ? await fetchBrandLogo(brand.logo_url) : null
  const showsSupplierMark = isRumbalist || brandLogo !== null

  // Supplier-branded when we know the supplier, Club Fuoco otherwise.
  const orgName = brand?.name ?? (isRumbalist ? 'Rumbalist' : 'Club Fuoco')
  const bgColor = brand?.color ? hexToPassRgb(brand.color) ?? 'rgb(18, 20, 20)'
                : isRumbalist ? 'rgb(255, 45, 146)' : 'rgb(18, 20, 20)'

  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       booking.id,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    // Surfaces on the lock screen on the night itself, then files itself under
    // "Expired Passes" the next morning instead of sitting in the wallet
    // looking as current as tonight's booking.
    ...nightPassDates(booking.booking_date),
    organizationName:   orgName,
    description:        brand || isRumbalist ? `${clubName} with ${orgName}` : `${clubName} ticket`,
    foregroundColor:    'rgb(255, 255, 255)',
    backgroundColor:    bgColor,
    labelColor:         isRumbalist ? 'rgb(255, 226, 240)' : 'rgb(255, 180, 166)',
    // A supplier's logo IS their wordmark, so logoText beside it is both
    // redundant and harmful: the two compete for one row and Wallet truncates
    // the text ("C…"). Omit it for any supplier mark, not just Rumba's.
    // OMIT the key entirely — passkit-generator's Joi schema rejects empty
    // strings (silently — then type never gets set → "MISSING_TYPE" 500 at
    // close()).
    ...(showsSupplierMark ? {} : { logoText: 'Club Fuoco' }),
    eventTicket: {
      primaryFields: [
        { key: 'venue', label: 'VENUE', value: clubName },
      ],
      secondaryFields: [
        { key: 'date',  label: 'DATE',   value: dateStr },
        { key: 'type',  label: 'TICKET', value: booking.booking_type === 'vip' ? 'VIP' : 'General' },
      ],
      // PAID row is dropped on Rumbalist passes — free guestlists would show
      // "€0.00" which reads as a glitch, and paid VIP tables don't need the
      // amount on the wallet face. Club Fuoco passes keep it when there's an
      // amount to show.
      auxiliaryFields: isRumbalist
        ? [
            { key: 'guests', label: 'GUESTS', value: String(booking.party_size) },
          ]
        : (booking.total_amount ?? 0) > 0
        ? [
            { key: 'guests', label: 'GUESTS', value: String(booking.party_size) },
            { key: 'paid',   label: 'PAID',   value: `€${(booking.total_amount ?? 0).toFixed(2)}` },
          ]
        : [
            { key: 'guests', label: 'GUESTS', value: String(booking.party_size) },
          ],
      backFields: [
        { key: 'address', label: 'LOCATION', value: address },
        { key: 'support', label: 'SUPPORT',  value: 'tickets@clubfuoco.com' },
        { key: 'terms',   label: 'TERMS',
          value: 'Non-transferable. Present at door. Service fee non-refundable.' },
      ],
    },
    barcodes: [
      {
        message:         booking.qr_code_token ?? booking.id,
        format:          'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
    // Legacy barcode field for older iOS
    barcode: {
      message:         booking.qr_code_token ?? booking.id,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    },
  }

  const assetsDir = path.join(process.cwd(), 'public', 'pass-assets')

  // Read every logo variant with a literal string path so Vercel's static
  // file tracer bundles them into the serverless function. (Reading via a
  // variable name skips the tracer → ENOENT on Vercel → 500.) We pick the
  // Rumbalist variant only AFTER both are loaded.
  const logoFuoco       = fs.readFileSync(path.join(assetsDir, 'logo.png'))
  const logoFuoco2x     = fs.readFileSync(path.join(assetsDir, 'logo@2x.png'))
  const logoRumbalist   = fs.readFileSync(path.join(assetsDir, 'logo-rumbalist.png'))
  const logoRumbalist2x = fs.readFileSync(path.join(assetsDir, 'logo-rumbalist@2x.png'))

  // Each slot is fitted to Apple's point box for that scale — the bundled
  // marks are already correct pairs, but a hosted one is whatever the
  // supplier happened to upload.
  const logo1x = brandLogo ? await fitLogo(brandLogo, 1) : (isRumbalist ? logoRumbalist   : logoFuoco)
  const logo2x = brandLogo ? await fitLogo(brandLogo, 2) : (isRumbalist ? logoRumbalist2x : logoFuoco2x)

  try {
    const pass = new PKPass(
      {
        'pass.json':   Buffer.from(JSON.stringify(passJson)),
        'icon.png':    fs.readFileSync(path.join(assetsDir, 'icon.png')),
        'icon@2x.png': fs.readFileSync(path.join(assetsDir, 'icon@2x.png')),
        'icon@3x.png': fs.readFileSync(path.join(assetsDir, 'icon@3x.png')),
        'logo.png':    logo1x,
        'logo@2x.png': logo2x,
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
        'Content-Disposition': `attachment; filename="clubfuoco-${booking.id}.pkpass"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err: any) {
    console.error('[wallet] pass generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate pass' }, { status: 500 })
  }
}
