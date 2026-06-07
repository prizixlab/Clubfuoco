import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import path from 'path'
import fs from 'fs'
import { RUMBALIST_OFFERS } from '@/lib/rumbalist-offers'

// Apple Wallet pass generation
// Required env vars (all cert values are base64-encoded PEM):
//   APPLE_PASS_TYPE_ID      — e.g. pass.com.clubfuoco.ticket
//   APPLE_TEAM_ID           — your 10-char Apple Team ID
//   APPLE_WWDR_PEM          — Apple WWDR G4 certificate (base64-encoded)
//   APPLE_SIGNER_CERT_PEM   — your Pass Type ID certificate (base64-encoded)
//   APPLE_SIGNER_KEY_PEM    — private key for the cert (base64-encoded)
//   APPLE_SIGNER_KEY_PASS   — passphrase for the key (optional)

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
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_type, party_size, booking_date, status, total_amount, qr_code_token, club_id,
      clubs (id, name, address, neighborhood)
    `)
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

  // Rumbalist partner bookings get a Miami-pink pass with the Rumbalist
  // wordmark in the logo slot. Detected by club id, so this stays in sync
  // with the rest of the app's Rumbalist routing (same source of truth).
  const isRumbalist = booking.club_id && booking.club_id in RUMBALIST_OFFERS

  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       booking.id,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   isRumbalist ? 'Rumbalist' : 'Club Fuoco',
    description:        isRumbalist
      ? `${clubName} with Rumbalist`
      : `${clubName} ticket`,
    foregroundColor:    'rgb(255, 255, 255)',
    backgroundColor:    isRumbalist ? 'rgb(255, 45, 146)' : 'rgb(18, 20, 20)',
    labelColor:         isRumbalist ? 'rgb(255, 226, 240)' : 'rgb(255, 180, 166)',
    // Rumbalist passes show the wordmark in the logo image — duplicating it
    // as logoText would be redundant. We OMIT the key entirely for partners;
    // passkit-generator's Joi schema rejects empty strings (silently — then
    // type never gets set → "MISSING_TYPE" 500 at close()).
    ...(isRumbalist ? {} : { logoText: 'Club Fuoco' }),
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
      // amount on the wallet face.
      auxiliaryFields: isRumbalist
        ? [
            { key: 'guests', label: 'GUESTS', value: String(booking.party_size) },
          ]
        : [
            { key: 'guests', label: 'GUESTS', value: String(booking.party_size) },
            { key: 'paid',   label: 'PAID',   value: `€${(booking.total_amount ?? 0).toFixed(2)}` },
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

  try {
    const pass = new PKPass(
      {
        'pass.json':   Buffer.from(JSON.stringify(passJson)),
        'icon.png':    fs.readFileSync(path.join(assetsDir, 'icon.png')),
        'icon@2x.png': fs.readFileSync(path.join(assetsDir, 'icon@2x.png')),
        'icon@3x.png': fs.readFileSync(path.join(assetsDir, 'icon@3x.png')),
        'logo.png':    isRumbalist ? logoRumbalist   : logoFuoco,
        'logo@2x.png': isRumbalist ? logoRumbalist2x : logoFuoco2x,
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
