import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand, updateBrand } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// POST /api/portal/brands/:id/logo — multipart upload ("logo" field) to the
// public `brand` bucket at brand/<key>/logo.<ext>, then set logo_url with a
// ?v=<ts> cache-buster so a re-upload shows immediately despite CDN caches.
const MAX_BYTES = 2 * 1024 * 1024
const BUCKET = 'brand'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params

  const form = await request.formData().catch(() => null)
  const file = form?.get('logo')
  if (!(file instanceof File)) return err('logo file is required (multipart field "logo")')
  if (file.size === 0) return err('logo is empty')
  if (file.size > MAX_BYTES) return err('logo too large (max 2 MB)', 413)

  const bytes = Buffer.from(await file.arrayBuffer())

  // PNG or SVG only — sniff content, don't trust the client's type/filename.
  let ext: 'png' | 'svg'
  let contentType: string
  const isPng = bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase()
  const isSvg = head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
  if (isPng)      { ext = 'png'; contentType = 'image/png' }
  else if (isSvg) { ext = 'svg'; contentType = 'image/svg+xml' }
  else return err('logo must be a PNG or SVG')

  const sb = await createServiceClient()
  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)

  const path = `${brand.key}/logo.${ext}`
  const { error: uploadError } = await sb.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true })
  if (uploadError) return err(uploadError.message, 500)

  // Drop the other-extension variant so a png→svg swap can't leave a stale
  // file that some cached logo_url still points at.
  const other = `${brand.key}/logo.${ext === 'png' ? 'svg' : 'png'}`
  await sb.storage.from(BUCKET).remove([other])

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
  const logo_url = `${pub.publicUrl}?v=${Date.now()}`
  try {
    await updateBrand(sb, id, { logo_url })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not save logo_url', 500)
  }
  return ok({ logo_url })
}
