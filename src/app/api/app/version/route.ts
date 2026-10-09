import { ok } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// GET /api/app/version → { latest, minimum, store_url }
//
// What the consumer iOS app must be at to keep running. The app blocks itself
// with an "Update Club Fuoco" screen when it is below `minimum`, and never
// blocks when this can't be reached.
//
// `minimum` follows the App Store by itself: the live version, once it has
// been out for GRACE_HOURS. Apple's public catalog (and each country's store)
// lags a release by hours — forcing an update a phone's App Store can't yet
// offer would lock that guest out — so a fresh release is NOT demanded until
// every store has it.
//
// Overrides, set in Vercel, no app release needed:
//   APP_FORCE_UPDATE=off      never force anyone (minimum: null)
//   APP_MIN_VERSION=1.18      demand exactly this version instead

const APP_ID = '6770632084'
const STORE_URL = `https://apps.apple.com/app/id${APP_ID}`
const GRACE_HOURS = 6
const CACHE_MS = 10 * 60_000

let cached: { at: number; version: string | null; released: string | null } | null = null

async function liveVersion(): Promise<{ version: string | null; released: string | null }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${APP_ID}&country=es`, { cache: 'no-store' })
    const j = await r.json() as { results?: { version?: string; currentVersionReleaseDate?: string }[] }
    const hit = j.results?.[0]
    cached = { at: Date.now(), version: hit?.version ?? null, released: hit?.currentVersionReleaseDate ?? null }
  } catch {
    // Apple unreachable: keep the last answer, or force nothing.
    cached = cached ? { ...cached, at: Date.now() } : { at: Date.now(), version: null, released: null }
  }
  return cached
}

export async function GET() {
  const { version, released } = await liveVersion()
  const off = process.env.APP_FORCE_UPDATE === 'off'
  const pinned = process.env.APP_MIN_VERSION?.trim() || null
  const settled = released != null
    && Date.now() - Date.parse(released) >= GRACE_HOURS * 3_600_000

  const minimum = off ? null : pinned ?? (settled ? version : null)
  const res = ok({ latest: version, minimum, store_url: STORE_URL })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
