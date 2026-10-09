import { ok } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// GET /api/app/version → { latest, minimum, store_url }
//
// What the consumer iOS app must be at to keep running: ALWAYS the version the
// App Store is offering right now (Apple's public lookup). The app blocks itself
// with an "Update Club Fuoco" screen when it is below `minimum`, and never
// blocks when this can't be reached.

const APP_ID = '6770632084'
const STORE_URL = `https://apps.apple.com/app/id${APP_ID}`
const CACHE_MS = 60_000

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
  const { version } = await liveVersion()
  // PAUSED (Yakov, 9 Oct 2026) while he works on dev builds: nobody is forced.
  // To turn forcing back on, set `minimum: version`.
  const res = ok({ latest: version, minimum: null, store_url: STORE_URL })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
