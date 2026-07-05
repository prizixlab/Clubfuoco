import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// POST /api/account/avatar — set the requesting user's profile photo.
// Body: { image: <base64 JPEG> }. The client downscales/compresses before
// sending (native sends ≤512px JPEG); this is a hard server-side cap only.
// Stored at avatars/{uid}.jpg (public bucket); users.avatar_url gets the
// public URL with a ?v=<ts> cache-buster so a replaced photo shows up
// immediately despite CDN/client caches.
const MAX_BYTES = 3 * 1024 * 1024

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await request.json().catch(() => null)
  const base64 = typeof body?.image === 'string' ? body.image : null
  if (!base64) return err('image (base64) is required')

  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return err('image is not valid base64')
  }
  if (bytes.length === 0) return err('image is empty')
  if (bytes.length > MAX_BYTES) return err('image too large (max 3 MB)', 413)
  // JPEG magic number — the app always sends JPEG.
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return err('image must be a JPEG')

  const supabase = await createServiceClient()
  const path = `${user!.id}.jpg`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) return err(uploadError.message)

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
  const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('users')
    .update({ avatar_url: avatarUrl })
    .eq('id', user!.id)
  if (updateError) return err(updateError.message)

  return ok({ avatar_url: avatarUrl })
}

// DELETE /api/account/avatar — remove the profile photo.
export async function DELETE() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()
  await supabase.storage.from('avatars').remove([`${user!.id}.jpg`])
  const { error } = await supabase
    .from('users')
    .update({ avatar_url: null })
    .eq('id', user!.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return ok({ deleted: true })
}
