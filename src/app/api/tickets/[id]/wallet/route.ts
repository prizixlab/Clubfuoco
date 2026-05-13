import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import path from 'path'
import fs from 'fs'

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
    return NextResponse.json({ error: 'Apple Wallet not configured yet' }, { status: 503 })
  }

  const supabase = await createServiceClient()
  const { data: order, error } = await supabase
    .from('ticket_orders')
    .select(`
      id, event_name, venue_name, venue_place_id, event_date,
      quantity, base_price_cents, markup_cents, total_cents,
      status, platform, platform_event_id, created_at
    `)
    .eq('id', id)
    .single()

  if (error || !order) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  if (order.status !== 'paid') {
    return NextResponse.json({ error: 'Ticket not yet paid' }, { status: 400 })
  }

  const eventDate = order.event_date ? new Date(order.event_date) : null
  const dateStr   = eventDate
    ? eventDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'Check event details'

  const totalEur = ((order.total_cents ?? 0) / 100).toFixed(2)

  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       `ticket-${order.id}`,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   'Club Fuoco',
    description:        order.event_name,
    foregroundColor:    'rgb(255, 255, 255)',
    backgroundColor:    'rgb(18, 20, 20)',
    labelColor:         'rgb(255, 180, 166)',
    logoText:           'Club Fuoco',
    eventTicket: {
      primaryFields: [
        { key: 'event', label: 'EVENT', value: order.event_name },
      ],
      secondaryFields: [
        { key: 'date',  label: 'DATE',  value: dateStr },
        { key: 'venue', label: 'VENUE', value: order.venue_name ?? 'Barcelona' },
      ],
      auxiliaryFields: [
        { key: 'qty',  label: 'QTY',  value: String(order.quantity ?? 1) },
        { key: 'paid', label: 'PAID', value: `€${totalEur}` },
      ],
      backFields: [
        { key: 'order_id', label: 'ORDER REF', value: order.id },
        { key: 'platform', label: 'PLATFORM',  value: order.platform ?? 'Club Fuoco' },
        { key: 'support',  label: 'SUPPORT',   value: 'tickets@clubfuoco.com' },
        { key: 'terms',    label: 'TERMS',     value: 'Non-transferable. Present at door. Service fee non-refundable.' },
      ],
    },
    barcodes: [
      {
        message:         order.id,
        format:          'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
    barcode: {
      message:         order.id,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    },
  }

  const assetsDir = path.join(process.cwd(), 'public', 'pass-assets')

  try {
    const pass = new PKPass(
      {
        'pass.json':  Buffer.from(JSON.stringify(passJson)),
        'icon.png':   fs.readFileSync(path.join(assetsDir, 'icon.png')),
        'icon@2x.png': fs.readFileSync(path.join(assetsDir, 'icon@2x.png')),
        'icon@3x.png': fs.readFileSync(path.join(assetsDir, 'icon@3x.png')),
        'logo.png':   fs.readFileSync(path.join(assetsDir, 'logo.png')),
        'logo@2x.png': fs.readFileSync(path.join(assetsDir, 'logo@2x.png')),
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
        'Content-Disposition': `attachment; filename="clubfuoco-ticket-${order.id}.pkpass"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err: any) {
    console.error('[wallet] ticket pass generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate pass' }, { status: 500 })
  }
}
