import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import path from 'path'
import fs from 'fs'

// ─── Tier themes — mirroring the profile card ─────────────────────────────────
// bg     = darkest card gradient stop
// fg     = primary accent (names, values)
// label  = muted accent (PKPass label text)
// header = tier display name shown in the pass header
const TIER: Record<string, {
  bg: string; fg: string; label: string; header: string; logoText: string
}> = {
  gold: {
    bg:       'rgb(36, 20, 12)',
    fg:       'rgb(255, 232, 181)',
    label:    'rgb(194, 139,  61)',
    header:   'ORO',
    logoText: 'Club Fuoco · Oro',
  },
  sapphire: {
    bg:       'rgb(14, 27, 74)',
    fg:       'rgb(221, 230, 255)',
    label:    'rgb(74, 107, 196)',
    header:   'ZAFFIRO',
    logoText: 'Club Fuoco · Zaffiro',
  },
  black: {
    bg:       'rgb(8, 8, 8)',
    fg:       'rgb(232, 182, 91)',
    label:    'rgb(140,  90, 30)',
    header:   'NERO',
    logoText: 'Club Fuoco · Nero',
  },
}

const CONFIGURED =
  !!process.env.APPLE_PASS_TYPE_ID &&
  !!process.env.APPLE_TEAM_ID &&
  !!process.env.APPLE_WWDR_PEM &&
  !!process.env.APPLE_SIGNER_CERT_PEM &&
  !!process.env.APPLE_SIGNER_KEY_PEM

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params

  if (!CONFIGURED) {
    return NextResponse.json({ error: 'Apple Wallet not configured yet' }, { status: 503 })
  }

  const supabase = await createServiceClient()

  const { data: user, error: uErr } = await supabase
    .from('users')
    .select('id, full_name, membership_tier, created_at')
    .eq('id', userId)
    .single()

  if (uErr || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const tier = user.membership_tier as string
  if (tier === 'free') {
    return NextResponse.json({ error: 'No paid membership' }, { status: 400 })
  }

  // Membership row is optional (manually-set tiers may not have one)
  const { data: membership } = await supabase
    .from('memberships')
    .select('valid_until, status')
    .eq('user_id', userId)
    .single()

  if (membership?.status === 'cancelled') {
    return NextResponse.json({ error: 'Membership cancelled' }, { status: 400 })
  }

  const t        = TIER[tier] ?? TIER.gold
  const fullName = (user.full_name ?? 'Member').trim()
  const joinYear = user.created_at
    ? String(new Date(user.created_at).getFullYear())
    : '—'

  // Deterministic member number — matches profile page
  const memberNum = String(
    (userId.charCodeAt(0) * 7 + userId.charCodeAt(userId.length - 1) * 3) % 999 + 1
  ).padStart(3, '0')

  const expirationDate = membership?.valid_until

  // ── Pass layout (inspired by profile card) ────────────────────────────────
  //
  //  ┌────────────────────────────────────────────┐
  //  │  [logo]  Club Fuoco · Oro        [ORO]     │  ← headerFields
  //  │                                            │
  //  │  SOCIO · MEMBRO                            │
  //  │  [Full Name]                               │  ← primaryFields
  //  │                                            │
  //  │  N°          EST.                          │  ← secondaryFields
  //  │  042         2025                          │
  //  │                                            │
  //  │  STATO / VALIDO FINO A                     │  ← auxiliaryFields
  //  │  Attivo / 12 June 2026                     │
  //  │                                            │
  //  │  [QR code]                                 │
  //  └────────────────────────────────────────────┘

  const passJson: Record<string, unknown> = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       `membership-${userId}`,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   'Club Fuoco',
    description:        `Club Fuoco ${t.header} Membership`,
    foregroundColor:    t.fg,
    backgroundColor:    t.bg,
    labelColor:         t.label,
    logoText:           t.logoText,

    storeCard: {
      // Top-right: tier name (mirrors the "N° XX  MILANO" corner labels)
      headerFields: [
        { key: 'tier_badge', label: '', value: t.header },
      ],

      // Main: member name with Italian/English label
      primaryFields: [
        { key: 'member', label: 'SOCIO · MEMBRO', value: fullName },
      ],

      // Row: member number + founding year (mirrors card corners)
      secondaryFields: [
        { key: 'number', label: 'N°',   value: memberNum },
        { key: 'est',    label: 'EST.', value: joinYear  },
      ],

      // Row: membership status / expiry
      auxiliaryFields: expirationDate
        ? [{ key: 'valid', label: 'VALIDO FINO A',
             value: new Date(expirationDate).toLocaleDateString('en-GB', {
               day: 'numeric', month: 'long', year: 'numeric',
             }) }]
        : [{ key: 'valid', label: 'STATO', value: 'Attivo' }],

      // Back of card
      backFields: [
        { key: 'name',    label: 'NOME COMPLETO', value: fullName },
        { key: 'tier',    label: 'LIVELLO',        value: t.header },
        { key: 'number',  label: 'N° SOCIO',       value: memberNum },
        { key: 'support', label: 'SUPPORTO',       value: 'members@clubfuoco.com' },
        { key: 'terms',   label: 'NOTE',
          value: 'Non trasferibile. La tessera scade automaticamente alla fine del periodo di abbonamento.' },
      ],
    },

    barcodes: [
      { message: userId, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
    ],
    barcode:
      { message: userId, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
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
