import { createServiceClient } from '@/lib/supabase/server'

/**
 * Mirror a Google Place Photo into our own Supabase Storage.
 *
 * Why: storing the photo_reference means every view calls Google's Place Photo
 * endpoint to resolve it (billed, and only edge-cached for 24h). Mirroring the
 * bytes once means views serve from our bucket forever — zero Google calls, and
 * the venue keeps its photos even if the reference expires.
 *
 * Mirrored files use a `_g<N>` suffix so they can never collide with the
 * hand-curated `<club_id>.jpg` covers already in the bucket.
 *
 * Best-effort by design: any failure returns null and the caller keeps the
 * proxy path, so a flaky mirror degrades to the old behaviour instead of
 * dropping the photo.
 */

const BUCKET = 'venue-photos'
const KEY = process.env.GOOGLE_PLACES_API_KEY

export async function mirrorGooglePhoto(
  clubId: string, photoRef: string, index: number,
): Promise<string | null> {
  if (!KEY || !photoRef) return null
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${KEY}`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (!bytes.length || bytes.length > 8_000_000) return null

    const sb = await createServiceClient()
    const path = `${clubId}_g${index}.jpg`
    const { error } = await sb.storage.from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
    if (error) return null

    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch {
    return null
  }
}

/**
 * Mirror a list of photo references, returning storage URLs. Any reference
 * that fails to mirror falls back to the key-free proxy path, so the caller
 * always gets a usable URL for every photo.
 */
export async function mirrorPhotoRefs(
  clubId: string, refs: string[],
): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < refs.length; i++) {
    const url = await mirrorGooglePhoto(clubId, refs[i], i + 1)
    out.push(url ?? `/api/places/photo?ref=${refs[i]}&maxwidth=800`)
  }
  return out
}
