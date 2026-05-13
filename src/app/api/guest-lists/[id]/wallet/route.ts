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
  const { data: signup, error } = await supabase
    .from('guest_list_signups')
    .select(`
      id, full_name, party_size, status, tier, created_at,
      guest_lists (
        id, event_name, event_date, cutoff_time, free_entry_label,
        clubs (id, name, address, neighborhood)
      )
    `)
    .eq('id', id)
    .single()

  if (error || !signup) {
    return NextResponse.json({ error: 'Signup not found' }, { status: 404 })
  }

  const gl       = (signup as any).guest_lists
  const club     = gl?.clubs
  const clubName = club?.name ?? 'Club Fuoco'
  const address  = club?.address ?? 'Barcelona'
  const eventName = gl?.event_name ?? clubName

  const eventDate = gl?.event_date ? new Date(gl.event_date) : null
  const dateStr   = eventDate
    ? eventDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'Tonight'

  const passJson = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       `gl-${signup.id}`,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   'Club Fuoco',
    description:        `Guest List — ${clubName}`,
    foregroundColor:    'rgb(255, 255, 255)',
    backgroundColor:    'rgb(18, 20, 20)',
    labelColor:         'rgb(255, 180, 166)',
    logoText:           'Club Fuoco',
    eventTicket: {
      primaryFields: [
        { key: 'event', label: 'EVENT', value: eventName },
      ],
      secondaryFields: [
        { key: 'date',  label: 'DATE',    value: dateStr },
        { key: 'tier',  label: 'ACCESS',  value: signup.tier === 'vip' ? 'VIP' : (gl?.free_entry_label ?? 'Guest List') },
      ],
      auxiliaryFields: [
        { key: 'name',   label: 'NAME',   value: signup.full_name ?? 'Guest' },
        { key: 'guests', label: 'GUESTS', value: String(signup.party_size ?? 1) },
      ],
      backFields: [
        { key: 'venue',   label: 'VENUE',   value: clubName },
        { key: 'address', label: 'ADDRESS', value: address },
        { key: 'status',  label: 'STATUS',  value: signup.status === 'approved' ? 'Confirmed' : 'Pending Approval' },
        { key: 'support', label: 'SUPPORT', value: 'tickets@clubfuoco.com' },
        { key: 'terms',   label: 'TERMS',   value: 'Non-transferable. Present at door with ID.' },
      ],
    },
    barcodes: [
      {
        message:         signup.id,
        format:          'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
    barcode: {
      message:         signup.id,
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
        'Content-Disposition': `attachment; filename="clubfuoco-guestlist-${signup.id}.pkpass"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err: any) {
    console.error('[wallet] guest list pass generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate pass' }, { status: 500 })
  }
}
