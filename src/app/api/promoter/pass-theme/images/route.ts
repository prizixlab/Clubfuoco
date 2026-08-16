import { NextRequest } from 'next/server'
import { resolvePromoterCaller } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'
import { passThemeRow } from '@/lib/wallet/pass-theme'

// The six bitmaps that go into a promoter's pass bundle.
//
// The device renders them — either from an uploaded image or by typesetting a
// wordmark — because it can produce exact pixel sizes and preview the very
// bitmap it uploads, and because adding a native image library to a Vercel
// function to redo work the phone already did is a poor trade.
//
// The server still verifies every byte, because these end up inside a bundle
// signed with our Pass Type ID certificate. Verification is dimension + format
// only and needs no decoder: PNG puts width and height in the IHDR chunk, at a
// fixed offset, right after the magic number.

const BUCKET = 'brand'
const MAX_BYTES = 256 * 1024

/** field name → [file name in the bundle, exact width, exact height] */
const SLOTS: Record<string, [string, number, number]> = {
  logo1x: ['logo.png',     160,  50],
  logo2x: ['logo@2x.png',  320, 100],
  logo3x: ['logo@3x.png',  480, 150],
  icon1x: ['icon.png',      29,  29],
  icon2x: ['icon@2x.png',   58,  58],
  icon3x: ['icon@3x.png',   87,  87],
}

const COLUMN: Record<string, string> = {
  logo1x: 'logo_1x_url', logo2x: 'logo_2x_url', logo3x: 'logo_3x_url',
  icon1x: 'icon_1x_url', icon2x: 'icon_2x_url', icon3x: 'icon_3x_url',
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Width and height straight out of the IHDR chunk.
 *
 * A PNG is: 8-byte magic, then the first chunk, which the spec requires to be
 * IHDR — 4 bytes length, 4 bytes type, then width and height as big-endian
 * uint32. Anything that does not have IHDR exactly there is not a PNG we are
 * willing to sign, whatever the client called it.
 */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// POST — multipart, all six slots required. All-or-nothing on purpose: a
// bundle carrying a promoter's logo at @2x and the house mark at @1x would
// render differently depending on the device.
export async function POST(request: NextRequest) {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const form = await request.formData().catch(() => null)
  if (!form) return err('Expected a multipart upload')

  // Validate everything BEFORE writing anything, so a bad slot cannot leave
  // half a logo in storage.
  const verified: { field: string; file: string; bytes: Buffer }[] = []
  for (const [field, [file, w, h]] of Object.entries(SLOTS)) {
    const part = form.get(field)
    if (!(part instanceof File)) return err(`Missing image: ${field}`)
    if (part.size === 0) return err(`${field} is empty`)
    if (part.size > MAX_BYTES) return err(`${field} is too large (max 256 KB)`, 413)

    const bytes = Buffer.from(await part.arrayBuffer())
    const size = pngSize(bytes)
    if (!size) return err(`${field} is not a PNG`)
    if (size.width !== w || size.height !== h) {
      return err(`${field} must be exactly ${w}×${h}px (got ${size.width}×${size.height})`)
    }
    verified.push({ field, file, bytes })
  }

  const patch: Record<string, string> = {}
  for (const { field, file, bytes } of verified) {
    const path = `pass-themes/${userId}/${file}`
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (error) return err(`Could not store ${file}: ${error.message}`, 500)
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
    // Cache-buster: a re-upload has the same path, and the pass route fetches
    // these over HTTP, so without it a CDN can serve the previous mark.
    patch[COLUMN[field]] = `${pub.publicUrl}?v=${Date.now()}`
  }

  const current = await passThemeRow(sb, userId)
  const { error } = await sb
    .from('promoter_pass_themes')
    .upsert({ user_id: userId, ...current, ...patch }, { onConflict: 'user_id' })
  if (error) return err(error.message, 500)

  return ok({ updated: true, images: Object.keys(patch).length })
}

// DELETE — drop the promoter's mark. The stored files go too, so a later
// re-upload cannot resurrect an old logo through a stale cached URL.
export async function DELETE() {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  await sb.storage
    .from(BUCKET)
    .remove(Object.values(SLOTS).map(([file]) => `pass-themes/${userId}/${file}`))

  const current = await passThemeRow(sb, userId)
  const cleared = Object.fromEntries(Object.values(COLUMN).map(c => [c, null]))
  const { error } = await sb
    .from('promoter_pass_themes')
    .upsert({ user_id: userId, ...current, ...cleared, logo_mode: 'none' }, { onConflict: 'user_id' })
  if (error) return err(error.message, 500)

  return ok({ cleared: true })
}
