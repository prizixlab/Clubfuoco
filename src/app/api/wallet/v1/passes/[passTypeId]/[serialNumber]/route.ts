import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { validateWalletToken, userIdFromSerial } from '@/lib/wallet/token'
import { PKPass } from 'passkit-generator'
import { deflateSync, crc32 } from 'zlib'
import path from 'path'
import fs from 'fs'

type Ctx = { params: Promise<{ passTypeId: string; serialNumber: string }> }

// ── Auth helper ───────────────────────────────────────────────────────────────

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? ''
  const match = auth.match(/^ApplePass\s+(.+)$/i)
  return match ? match[1].trim() : null
}

// ── Gradient PNG (same as in the membership wallet route) ────────────────────

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
function makeGradientPng(w: number, h: number, stops: { pos: number; rgb: RGB }[]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    const ty = y / (h - 1)
    for (let x = 0; x < w; x++) {
      const tx = x / (w - 1)
      const t = Math.min(1, Math.max(0, ty * 0.65 + tx * 0.35))
      let rgb: RGB = stops[0].rgb
      for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i], s1 = stops[i + 1]
        if (t >= s0.pos && t <= s1.pos) {
          rgb = lerpRGB(s0.rgb, s1.rgb, (t - s0.pos) / (s1.pos - s0.pos))
          break
        }
        if (t > s1.pos) rgb = s1.rgb
      }
      const off = y * (1 + w * 3) + 1 + x * 3
      raw[off] = rgb[0]; raw[off + 1] = rgb[1]; raw[off + 2] = rgb[2]
    }
    raw[y * (1 + w * 3)] = 0
  }
  const idat = deflateSync(raw, { level: 6 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const TIER: Record<string, {
  fg: string; label: string; header: string; logoText: string
  gradient: { pos: number; rgb: RGB }[]
  bodyColor: RGB
}> = {
  gold: {
    fg: 'rgb(255, 241, 210)', label: 'rgb(220, 175, 100)',
    header: 'ORO', logoText: 'Club Fuoco · Oro',
    bodyColor: [112, 70, 22],
    gradient: [
      { pos: 0.00, rgb: [42, 24, 16] }, { pos: 0.38, rgb: [74, 44, 14] },
      { pos: 0.72, rgb: [140, 90, 30] }, { pos: 1.00, rgb: [194, 139, 61] },
    ],
  },
  sapphire: {
    fg: 'rgb(200, 218, 255)', label: 'rgb(80, 125, 240)',
    header: 'ZAFFIRO', logoText: 'Club Fuoco · Zaffiro',
    bodyColor: [4, 8, 40],
    gradient: [
      { pos: 0.00, rgb: [2, 4, 18] }, { pos: 0.50, rgb: [6, 16, 72] },
      { pos: 1.00, rgb: [22, 58, 168] },
    ],
  },
  black: {
    fg: 'rgb(232, 182, 91)', label: 'rgb(175, 130, 55)',
    header: 'NERO', logoText: 'Club Fuoco · Nero',
    bodyColor: [20, 17, 13],
    gradient: [
      { pos: 0.00, rgb: [5, 5, 5] }, { pos: 0.60, rgb: [26, 22, 20] },
      { pos: 1.00, rgb: [42, 31, 18] },
    ],
  },
}

// ── GET — serve the latest pass for a serial number ──────────────────────────

export async function GET(req: NextRequest, { params }: Ctx) {
  const { serialNumber } = await params

  const token  = extractToken(req)
  const userId = userIdFromSerial(serialNumber)

  if (!token || !userId || !validateWalletToken(token, userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  // If membership is revoked, return 410 Gone — Apple Wallet removes the pass
  if (!user.membership_tier || user.membership_tier === 'free') {
    return new NextResponse(null, { status: 410 })
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('valid_until, status, updated_at')
    .eq('user_id', userId)
    .single()

  if (membership?.status === 'cancelled') {
    return new NextResponse(null, { status: 410 })
  }

  // 304 check — if pass hasn't changed since Apple last fetched it
  const lastModified = membership?.updated_at
    ? new Date(membership.updated_at)
    : new Date()
  const ifModifiedSince = req.headers.get('if-modified-since')
  if (ifModifiedSince) {
    const sinceDate = new Date(ifModifiedSince)
    if (lastModified <= sinceDate) {
      return new NextResponse(null, { status: 304 })
    }
  }

  const tier     = user.membership_tier as string
  const t        = TIER[tier] ?? TIER.gold
  const fullName = (user.full_name ?? 'Member').trim()
  const joinYear = user.created_at
    ? String(new Date(user.created_at).getFullYear()) : '—'
  const memberNum = String(
    (userId.charCodeAt(0) * 7 + userId.charCodeAt(userId.length - 1) * 3) % 999 + 1
  ).padStart(3, '0')
  const expirationDate = membership?.valid_until

  const serviceUrl = process.env.APPLE_WALLET_SERVICE_URL ?? 'https://clubfuoco.vercel.app/api/wallet/v1'
  const { generateWalletToken } = await import('@/lib/wallet/token')
  const authToken = generateWalletToken(userId)

  const passJson: Record<string, unknown> = {
    formatVersion:       1,
    passTypeIdentifier:  process.env.APPLE_PASS_TYPE_ID!,
    serialNumber,
    teamIdentifier:      process.env.APPLE_TEAM_ID!,
    organizationName:    'Club Fuoco',
    description:         `Club Fuoco ${t.header} Membership`,
    foregroundColor:     t.fg,
    backgroundColor:     `rgb(${t.bodyColor[0]}, ${t.bodyColor[1]}, ${t.bodyColor[2]})`,
    labelColor:          t.label,
    logoText:            t.logoText,
    webServiceURL:       serviceUrl,
    authenticationToken: authToken,
    storeCard: {
      headerFields:    [{ key: 'number', label: 'N°', value: memberNum }],
      primaryFields:   [{ key: 'tier_name', label: 'CLUB FUOCO', value: t.header }],
      secondaryFields: [
        { key: 'member', label: 'SOCIO', value: fullName },
        { key: 'est',    label: 'EST.',  value: joinYear },
      ],
      auxiliaryFields: expirationDate
        ? [{ key: 'valid', label: 'VALIDO FINO A',
             value: new Date(expirationDate).toLocaleDateString('en-GB', {
               day: 'numeric', month: 'long', year: 'numeric' }) }]
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

  const strip1x = makeGradientPng(375,  84, t.gradient)
  const strip2x = makeGradientPng(750, 168, t.gradient)
  const strip3x = makeGradientPng(1125, 252, t.gradient)

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
        'Content-Type':   'application/vnd.apple.pkpass',
        'Last-Modified':  lastModified.toUTCString(),
        'Cache-Control':  'no-store',
      },
    })
  } catch (err) {
    console.error('[wallet update] pass generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate pass' }, { status: 500 })
  }
}
