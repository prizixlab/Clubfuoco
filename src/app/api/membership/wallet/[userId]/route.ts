import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PKPass } from 'passkit-generator'
import { deflateSync, crc32 } from 'zlib'
import path from 'path'
import fs from 'fs'

// ─── Minimal PNG encoder (no deps — uses built-in zlib) ───────────────────────
// Produces an RGB PNG with a diagonal gradient, matching the profile card style.

type RGB = [number, number, number]

function lerp(a: number, b: number, t: number) { return Math.round(a + (b - a) * t) }
function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len   = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeB = Buffer.from(type, 'ascii')
  const crcIn = Buffer.concat([typeB, data])
  const crcV  = crc32(crcIn) as unknown as number
  const crcB  = Buffer.alloc(4); crcB.writeUInt32BE(crcV >>> 0, 0)
  return Buffer.concat([len, typeB, data, crcB])
}

/**
 * Generate a gradient PNG that mirrors the profile card's diagonal gradient.
 * stops: [ { pos: 0–1, rgb: [r,g,b] }, ... ] sorted ascending by pos.
 */
function makeGradientPng(w: number, h: number, stops: { pos: number; rgb: RGB }[]): Buffer {
  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2  // 8-bit RGB

  // Raw scanlines: 1 filter byte + w*3 RGB bytes per row
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    // Diagonal t: combines both axes like a 155° linear-gradient
    const ty = y / (h - 1)
    for (let x = 0; x < w; x++) {
      const tx = x / (w - 1)
      // Weight towards bottom-right (155° ≈ 0.6·y + 0.4·x)
      const t = Math.min(1, Math.max(0, ty * 0.65 + tx * 0.35))

      // Interpolate across gradient stops
      let rgb: RGB = stops[0].rgb
      for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i], s1 = stops[i + 1]
        if (t >= s0.pos && t <= s1.pos) {
          const f = (t - s0.pos) / (s1.pos - s0.pos)
          rgb = lerpRGB(s0.rgb, s1.rgb, f)
          break
        }
        if (t > s1.pos) rgb = s1.rgb
      }

      const off = y * (1 + w * 3) + 1 + x * 3
      raw[off] = rgb[0]; raw[off + 1] = rgb[1]; raw[off + 2] = rgb[2]
    }
    raw[y * (1 + w * 3)] = 0  // filter: None
  }

  const idat = deflateSync(raw, { level: 6 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),  // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Tier definitions ─────────────────────────────────────────────────────────
// gradient  — exact CSS stops from the profile card, used to render strip.png
// bodyColor — mid-gradient sample so the card body (below the strip) flows
//             seamlessly from the strip rather than cutting to a flat colour.
//             Picked at ~55–60% of each gradient so it's visually "inside" it.

const TIER: Record<string, {
  fg: string; label: string; header: string; logoText: string
  gradient: { pos: number; rgb: RGB }[]
  bodyColor: RGB   // backgroundColor = this → whole card feels gradient-coloured
}> = {
  gold: {
    fg:        'rgb(255, 241, 210)',
    label:     'rgb(220, 175, 100)',
    header:    'ORO',
    logoText:  'Club Fuoco · Oro',
    bodyColor: [112, 70, 22],   // ~55% of the gold gradient → warm amber-brown
    gradient: [
      { pos: 0.00, rgb: [42,  24,  16] },
      { pos: 0.38, rgb: [74,  44,  14] },
      { pos: 0.72, rgb: [140, 90,  30] },
      { pos: 1.00, rgb: [194, 139, 61] },
    ],
  },
  sapphire: {
    fg:        'rgb(221, 230, 255)',
    label:     'rgb(160, 190, 255)',
    header:    'ZAFFIRO',
    logoText:  'Club Fuoco · Zaffiro',
    bodyColor: [28, 46, 122],   // ~45% of sapphire gradient → vivid navy
    gradient: [
      { pos: 0.00, rgb: [14,  27,  74]  },
      { pos: 0.45, rgb: [31,  53,  144] },
      { pos: 1.00, rgb: [74,  107, 196] },
    ],
  },
  black: {
    fg:        'rgb(232, 182, 91)',
    label:     'rgb(175, 130, 55)',
    header:    'NERO',
    logoText:  'Club Fuoco · Nero',
    bodyColor: [20, 17, 13],    // ~55% of black gradient → dark warm charcoal
    gradient: [
      { pos: 0.00, rgb: [5,  5,  5]  },
      { pos: 0.60, rgb: [26, 22, 20] },
      { pos: 1.00, rgb: [42, 31, 18] },
    ],
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

  const memberNum = String(
    (userId.charCodeAt(0) * 7 + userId.charCodeAt(userId.length - 1) * 3) % 999 + 1
  ).padStart(3, '0')

  const expirationDate = membership?.valid_until

  // Generate gradient strip images (750×168 = 2x, used for both strip and strip@2x)
  const strip1x = makeGradientPng(375,  84, t.gradient)
  const strip2x = makeGradientPng(750, 168, t.gradient)
  const strip3x = makeGradientPng(1125, 252, t.gradient)

  // ── Pass JSON ─────────────────────────────────────────────────────────────
  //
  //  ┌──────────────────────────────────────────────────────┐
  //  │  [logo] Club Fuoco · Oro              [N° 015]       │  header
  //  ├──────────────────────────────────────────────────────┤
  //  │  ░░░░░░░░░ gradient strip ░░░░░░░░░░░░░░░░░░░░░░░░░ │
  //  │  CLUB FUOCO                                          │
  //  │  ORO                        ← large primary value   │
  //  │                                                      │
  //  │  SOCIO              EST.                             │  secondary
  //  │  Yakov Vinnik       2026                             │
  //  │                                                      │
  //  │  STATO                                               │  auxiliary
  //  │  Attivo                                              │
  //  │                                                      │
  //  │  [QR]                                                │
  //  └──────────────────────────────────────────────────────┘

  const passJson: Record<string, unknown> = {
    formatVersion:      1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    serialNumber:       `membership-${userId}`,
    teamIdentifier:     process.env.APPLE_TEAM_ID!,
    organizationName:   'Club Fuoco',
    description:        `Club Fuoco ${t.header} Membership`,
    foregroundColor:    t.fg,
    backgroundColor:    `rgb(${t.bodyColor[0]}, ${t.bodyColor[1]}, ${t.bodyColor[2]})`,
    labelColor:         t.label,
    logoText:           t.logoText,

    storeCard: {
      headerFields: [
        { key: 'number', label: 'N°', value: memberNum },
      ],
      primaryFields: [
        { key: 'tier_name', label: 'CLUB FUOCO', value: t.header },
      ],
      secondaryFields: [
        { key: 'member', label: 'SOCIO', value: fullName },
        { key: 'est',    label: 'EST.',  value: joinYear  },
      ],
      auxiliaryFields: expirationDate
        ? [{ key: 'valid', label: 'VALIDO FINO A',
             value: new Date(expirationDate).toLocaleDateString('en-GB', {
               day: 'numeric', month: 'long', year: 'numeric',
             }) }]
        : [{ key: 'valid', label: 'STATO', value: 'Attivo' }],
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
    barcode: { message: userId, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
  }

  if (expirationDate) {
    passJson.expirationDate = new Date(expirationDate).toISOString()
  }

  const assetsDir = path.join(process.cwd(), 'public', 'pass-assets')

  try {
    const pass = new PKPass(
      {
        'pass.json':    Buffer.from(JSON.stringify(passJson)),
        'icon.png':     fs.readFileSync(path.join(assetsDir, 'icon.png')),
        'icon@2x.png':  fs.readFileSync(path.join(assetsDir, 'icon@2x.png')),
        'icon@3x.png':  fs.readFileSync(path.join(assetsDir, 'icon@3x.png')),
        'logo.png':     fs.readFileSync(path.join(assetsDir, 'logo.png')),
        'logo@2x.png':  fs.readFileSync(path.join(assetsDir, 'logo@2x.png')),
        // Gradient strip — gives each tier its characteristic colour wash
        'strip.png':    strip1x,
        'strip@2x.png': strip2x,
        'strip@3x.png': strip3x,
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
