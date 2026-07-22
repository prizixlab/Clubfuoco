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
