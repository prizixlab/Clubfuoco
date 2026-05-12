import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import path from 'path'
import fs from 'fs'

// Apple Wallet membership card
// Same env vars as the booking wallet route:
//   APPLE_PASS_TYPE_ID  APPLE_TEAM_ID  APPLE_WWDR_PEM
//   APPLE_SIGNER_CERT_PEM  APPLE_SIGNER_KEY_PEM  APPLE_SIGNER_KEY_PASS

const CONFIGURED =
  !!process.env.APPLE_PASS_TYPE_ID &&
  !!process.env.APPLE_TEAM_ID &&
  !!process.env.APPLE_WWDR_PEM &&
  !!process.env.APPLE_SIGNER_CERT_PEM &&
  !!process.env.APPLE_SIGNER_KEY_PEM

// Tier-specific pass colours (PKPass uses "rgb(r,g,b)" strings)
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

export async function GET() {
  if (!CONFIGURED) {
    return NextResponse.json(
      { error: 'Apple Wallet not configured yet' },
      { status: 503 }
    )
  }

  // ── Auth: get current user session ──────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Fetch user profile (name) and membership (tier, valid_until) ─────────────
  const service = await createServiceClient()

  const [{ data: profile }, { data: membership }] = await Promise.all([
    service.from('users').select('full_name, membership_tier').eq('id', user.id).single(),
    service.from('memberships').select('*').eq('user_id', user.id).single(),
  ])

  const tier = profile?.membership_tier ?? 'free'

  // Free users don't get a pass
  if (tier === 'free' || !membership) {
    return NextResponse.json({ error: 'No active membership' }, { status: 400 })
  }

  const colours  = TIER_COLOURS[tier] ?? TIER_COLOURS.gold
  const fullName = profile?.full_name ?? 'Member'
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] ?? 'Member'
  const lastName  = nameParts.slice(1).join(' ')

  // Member number derived from user id (same algorithm as profile page)
  const memberNum = String(
    (user.id.charCodeAt(0) * 7 + user.id.charCodeAt(user.id.length - 1) * 3) % 999 + 1
  ).padStart(3, '0')

  // Pass serial: prefix + user id (makes it unique per user)
  const serialNumber = `membership-${user.id}`

  // Expiration: when valid_until is set (subscription cancelled / payment lapsed),
  // iOS will mark the pass as expired and optionally remove it from Wallet.
  const expirationDate = membership.valid_until ?? undefined

  const passJson: Record<string, unknown> = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber,
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
          ? [{ key: 'valid', label: 'VALID UNTIL', value: new Date(expirationDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }]
          : [{ key: 'valid', label: 'STATUS',      value: 'Active' }]
        ),
        { key: 'city', label: 'CITY', value: 'Milano' },
      ],
      backFields: [
        { key: 'name',    label: 'FULL NAME',  value: fullName },
        { key: 'support', label: 'SUPPORT',    value: 'members@clubfuoco.com' },
        { key: 'terms',   label: 'TERMS',      value: 'Non-transferable. Membership automatically removed when subscription lapses.' },
      ],
    },
    barcodes: [
      {
        message:         user.id,
        format:          'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
    ],
    barcode: {
      message:         user.id,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    },
  }

  // Add expiration date so the pass auto-invalidates when subscription lapses
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
