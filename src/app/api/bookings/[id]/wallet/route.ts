import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { PKPass } from 'passkit-generator'

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
  const { user, response } = await requireAuth()
  if (response) return response

  if (!CONFIGURED) {
    return NextResponse.json(
      { error: 'Apple Wallet not configured yet' },
      { status: 503 }
    )
  }

  const supabase = await createClient()
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_type, party_size, booking_date, status, total_amount, qr_code_token,
      clubs (id, name, address, neighborhood)
    `)
    .eq('id', id)
    .eq('user_id', user!.id)
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

  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       booking.id,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   'Club Fuoco',
    description:        `${clubName} ticket`,
    foregroundColor:    'rgb(255, 255, 255)',
    backgroundColor:    'rgb(18, 20, 20)',
    labelColor:         'rgb(255, 180, 166)',
    logoText:           'Club Fuoco',
    eventTicket: {
      primaryFields: [
        { key: 'venue', label: 'VENUE', value: clubName },
      ],
      secondaryFields: [
        { key: 'date',  label: 'DATE',   value: dateStr },
        { key: 'type',  label: 'TICKET', value: booking.booking_type === 'vip' ? 'VIP' : 'General' },
      ],
      auxiliaryFields: [
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

  try {
    const pass = new PKPass(
      { 'pass.json': Buffer.from(JSON.stringify(passJson)) },
      {
        wwdr:               Buffer.from(process.env.APPLE_WWDR_PEM!,       'base64'),
        signerCert:         Buffer.from(process.env.APPLE_SIGNER_CERT_PEM!, 'base64'),
        signerKey:          Buffer.from(process.env.APPLE_SIGNER_KEY_PEM!,  'base64'),
        signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASS ?? '',
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
