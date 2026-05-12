import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import path from 'path'
import fs from 'fs'

// Public route — membership UUID acts as the credential (not guessable), same
// pattern as /api/bookings/[id]/wallet. This avoids the cookie problem when
// Browser.open() / SFSafariViewController opens a cookieless session.
//
// Env vars (base64-encoded PEM):
//   APPLE_PASS_TYPE_ID  APPLE_TEAM_ID  APPLE_WWDR_PEM
//   APPLE_SIGNER_CERT_PEM  APPLE_SIGNER_KEY_PEM  APPLE_SIGNER_KEY_PASS

const CONFIGURED =
  !!process.env.APPLE_PASS_TYPE_ID &&
  !!process.env.APPLE_TEAM_ID &&
  !!process.env.APPLE_WWDR_PEM &&
  !!process.env.APPLE_SIGNER_CERT_PEM &&
  !!process.env.APPLE_SIGNER_KEY_PEM

const TIER_COLOURS: Record<string, { bg: string; fg: string; label: string }> = {
  gold: {
    bg:    'rgb(42, 24, 16)',
    fg:    'rgb(255, 232, 181)',
    label: 'Oro · Gold',
  },
  sapphire: {
    bg:    'rgb(14, 27, 74)',
    fg:    'rgb(221, 230, 255)',
    label: 'Zaffiro · Sapphire',
  },
  black: {
    bg:    'rgb(5, 5, 5)',
    fg:    'rgb(232, 182, 91)',
    label: 'Nero · Black',
  },
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  const { membershipId } = await params

  if (!CONFIGURED) {
    return NextResponse.json(
      { error: 'Apple Wallet not configured yet' },
      { status: 503 }
    )
  }

  const supabase = await createServiceClient()

  // Membership UUID is the credential — fetch with join to get member name
  const { data: membership, error: mErr } = await supabase
    .from('memberships')
    .select('*, users(id, full_name)')
    .eq('id', membershipId)
    .single()

  if (mErr || !membership) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
  }

  if (membership.status === 'cancelled') {
    return NextResponse.json({ error: 'Membership cancelled' }, { status: 400 })
  }

  const user      = (membership as any).users
  const tier      = membership.tier as string
  const colours   = TIER_COLOURS[tier] ?? TIER_COLOURS.gold
  const fullName  = user?.full_name ?? 'Member'
  const userId    = user?.id ?? membershipId

  // Member number — same deterministic algo as profile page
  const memberNum = String(
    (userId.charCodeAt(0) * 7 + userId.charCodeAt(userId.length - 1) * 3) % 999 + 1
  ).padStart(3, '0')

  // expirationDate — when Stripe cancels / marks past_due the webhook sets
  // valid_until to the period end. Once that date passes iOS marks pass expired.
  const expirationDate = membership.valid_until ?? undefined

  const passJson: Record<string, unknown> = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       `membership-${membershipId}`,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   'Club Fuoco',
    description:        `Club Fuoco ${colours.label} Membership`,
    foregroundColor:    colours.fg,
    backgroundColor:    colours.bg,
    labelColor:         colours.fg,
    logoText:           'Club Fuoco',
    storeCard: {
      primaryFields: [
        { key: 'member', label: 'MEMBER', value: fullName },
      ],
      secondaryFields: [
        { key: 'tier',   label: 'TIER',   value: colours.label },
        { key: 'number', label: 'N°',     value: memberNum },
      ],
      auxiliaryFields: [
        ...(expirationDate
          ? [{ key: 'valid', label: 'VALID UNTIL',
               value: new Date(expirationDate).toLocaleDateString('en-GB', {
                 day: 'numeric', month: 'long', year: 'numeric',
               }) }]
          : [{ key: 'valid', label: 'STATUS', value: 'Active' }]
        ),
        { key: 'city', label: 'CITY', value: 'Milano' },
      ],
      backFields: [
        { key: 'name',    label: 'FULL NAME', value: fullName },
        { key: 'support', label: 'SUPPORT',   value: 'members@clubfuoco.com' },
        { key: 'terms',   label: 'TERMS',
          value: 'Non-transferable. Card auto-expires when subscription lapses.' },
      ],
    },
    barcodes: [
      {
        message:         membershipId,
        format:          'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
    barcode: {
      message:         membershipId,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    },
  }

  if (expirationDate) {
    passJson.expirationDate = new Date(expirationDate).toISOString()
  }

  const assetsDir = path.join(process.cwd(), 'public', 'pass-assets')

  try {
    const pass = new PKPass(
      {
        'pass.json':   Buffer.from(JSON.stringify(passJson)),
        'icon.png':    fs.readFileSync(path.join(assetsDir, 'icon.png')),
        'icon@2x.png': fs.readFileSync(path.join(assetsDir, 'icon@2x.png')),
        'icon@3x.png': fs.readFileSync(path.join(assetsDir, 'icon@3x.png')),
        'logo.png':    fs.readFileSync(path.join(assetsDir, 'logo.png')),
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
        'Content-Disposition': `attachment; filename="clubfuoco-membership.pkpass"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err: unknown) {
    console.error('[membership wallet] pass generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate pass' }, { status: 500 })
  }
}
