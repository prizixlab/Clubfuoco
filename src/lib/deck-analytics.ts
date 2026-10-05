// View tracking for /deck — the investor deck link used in cold outreach.
//
// Everything here is best-effort and must never affect the response: if the
// insert fails, the investor still gets the PDF. See recordDeckView.

import { createHmac } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { clientIp } from '@/lib/ratelimit'

// Link unfurlers fetch the URL the instant you paste it into an email or a
// DM, so without this every send would look like an open. Matched loosely on
// purpose — a missed bot inflates the count, and that's the failure that
// actually misleads you.
const BOT_PATTERN =
  /bot|crawler|spider|slack|linkedin|whatsapp|telegram|discord|facebookexternalhit|twitter|preview|fetcher|curl|wget|python-requests|axios|headless|lighthouse|monitoring|pingdom|uptime/i

export function looksLikeBot(userAgent: string | null): boolean {
  if (!userAgent) return true          // no UA at all is a script, not a person
  return BOT_PATTERN.test(userAgent)
}

/**
 * Stable per-visitor fingerprint that isn't personal data. Keyed on a server
 * secret so the hash can't be brute-forced back to an IP (the IPv4 space is
 * small enough that an unsalted hash would be reversible in seconds).
 */
function hashIp(ip: string): string | null {
  if (!ip || ip === 'unknown') return null
  const key = process.env.DECK_ANALYTICS_SALT ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createHmac('sha256', key).update(ip).digest('hex').slice(0, 32)
}

/** Coarse location Vercel derives at the edge. All null in local dev. */
function geoFrom(req: Request) {
  const h = req.headers
  const clean = (v: string | null) => {
    if (!v) return null
    // Vercel percent-encodes non-ASCII city names ("Barcelona" is fine,
    // "Málaga" arrives as "M%C3%A1laga").
    try { return decodeURIComponent(v) } catch { return v }
  }
  return {
    country:  clean(h.get('x-vercel-ip-country')),
    region:   clean(h.get('x-vercel-ip-country-region')),
    city:     clean(h.get('x-vercel-ip-city')),
    timezone: clean(h.get('x-vercel-ip-timezone')),
  }
}

/**
 * Log one fetch of the deck. Fire-and-forget by contract: callers must not let
 * a tracking failure reach the investor. Awaited rather than floated because
 * serverless kills un-awaited work once the response is sent — the insert is a
 * single round trip, and the route already waits on Storage for ~1MB.
 */
export async function recordDeckView(req: Request): Promise<void> {
  try {
    // HEAD is Next auto-answering with GET's headers, and a Range request is a
    // PDF viewer pulling another slice of a file it already opened. Neither is
    // a person opening the deck.
    if (req.method === 'HEAD') return
    if (req.headers.get('range')) return

    const userAgent = req.headers.get('user-agent')
    const url       = new URL(req.url)

    // ?i=<tag> is how outreach links are attributed: /deck?i=indexvc. The bare
    // /deck URL still works and lands as an untagged row, so the link already
    // sitting in someone's inbox keeps working.
    const recipient = url.searchParams.get('i')?.slice(0, 120).trim() || null

    const supabase = await createServiceClient()
    const { error } = await supabase.from('deck_views').insert({
      recipient,
      ...geoFrom(req),
      referrer:   req.headers.get('referer')?.slice(0, 500) ?? null,
      user_agent: userAgent?.slice(0, 500) ?? null,
      ip_hash:    hashIp(clientIp(req)),
      is_bot:     looksLikeBot(userAgent),
    })
    if (error) console.error('[deck] view insert failed:', error.message)
  } catch (e) {
    // Never rethrow — the deck download matters, the analytics row does not.
    console.error('[deck] view tracking threw:', e)
  }
}
