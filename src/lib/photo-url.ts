/**
 * Photo URL hygiene.
 *
 * Google Place Photo URLs embed the API key as a query param
 * (`…/place/photo?photo_reference=REF&key=KEY`). When those URLs are stored on
 * a row and served to clients, the key ships to every device — it leaked the
 * old key into ~1,188 rows this way. The proxy at /api/places/photo takes the
 * ref, adds the key server-side, and 302s to the CDN, so the client never sees
 * a key. Everything that writes a photo URL should store the proxy path.
 */

/** True for a Google Place Photo URL that embeds an API key. */
export function isLeakyGooglePhoto(url: unknown): url is string {
  return typeof url === 'string'
    && url.includes('maps.googleapis.com')
    && url.includes('/place/photo')
    && /[?&]key=/.test(url)
}

/**
 * Convert a Google Place Photo URL to the key-free proxy path. Non-Google URLs
 * (curated Supabase covers, already-proxied paths) pass through untouched, so
 * this is safe to map over mixed columns.
 */
export function toProxyPhotoUrl(url: string): string {
  if (!isLeakyGooglePhoto(url)) return url
  const q = url.slice(url.indexOf('?') + 1)
  const params = new URLSearchParams(q)
  const ref = params.get('photo_reference')
  if (!ref) return url                       // malformed — leave it, don't invent
  const maxwidth = params.get('maxwidth') ?? '800'
  return `/api/places/photo?ref=${ref}&maxwidth=${maxwidth}`
}

// ── Thumbnails ───────────────────────────────────────────────────────────────
// Mirrored photos land in Storage at Google's maxwidth=800 (~155 KB of JPEG).
// A feed showing twenty of those is ~3 MB, which is the single biggest thing the
// app transfers. Supabase's render endpoint resizes on the fly and negotiates
// WebP from the Accept header — measured on a real cover: 175 KB → 28 KB (84%
// smaller) at width 400.
//
// Applied server-side where feed payloads are built, so web AND the native apps
// get it with no client release.

const STORAGE_OBJECT = '/storage/v1/object/public/'
const STORAGE_RENDER = '/storage/v1/render/image/public/'

/** Feed/list cards. */
export const THUMB = { width: 400, quality: 70 }
/** Detail hero — full mirrored width, but still re-encoded to WebP. */
export const HERO = { width: 800, quality: 78 }

/**
 * Rewrite a Supabase Storage URL to a resized/re-encoded variant. Anything else
 * — the /api/places/photo proxy, curated external URLs — passes through
 * untouched, so this is safe to map over mixed columns.
 */
export function sizedPhotoUrl(
  url: string | null | undefined,
  { width, quality }: { width: number; quality: number } = THUMB,
): string | null {
  if (!url || typeof url !== 'string') return url ?? null
  if (!url.includes(STORAGE_OBJECT)) return url
  // Already transformed — don't stack query strings.
  if (url.includes(STORAGE_RENDER)) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url.replace(STORAGE_OBJECT, STORAGE_RENDER)}${sep}width=${width}&quality=${quality}`
}

/** Map a list of photo URLs to one size. */
export function sizedPhotoUrls(
  urls: unknown,
  size: { width: number; quality: number } = THUMB,
): string[] {
  if (!Array.isArray(urls)) return []
  return urls
    .filter((u): u is string => typeof u === 'string')
    .map(u => sizedPhotoUrl(u, size) as string)
}
