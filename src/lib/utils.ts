import { NextResponse } from 'next/server'
import type { ApiResponse } from '@/types'
import { currentNight, nightsBetween } from '@/lib/hours'

// Cache hints handed to Vercel's edge cache. Pick the preset that matches how
// hot the endpoint is and how stale data is allowed to be. `none` is the safe
// default for user-specific data (bookings, favorites) — don't cache anything
// personal at the edge.
export type CacheHint =
  | 'none'        // user-specific or write paths — Cache-Control: no-store
  | 'short'       // 60s edge, 5min SWR (list endpoints, hot data)
  | 'medium'      // 5min edge, 1hr SWR (detail endpoints, slow-moving)
  | 'long'        // 1hr edge, 24hr SWR (static-ish reference data)

const CACHE_HEADERS: Record<CacheHint, string> = {
  none:   'private, no-store',
  short:  'public, s-maxage=60, stale-while-revalidate=300',
  medium: 'public, s-maxage=300, stale-while-revalidate=3600',
  long:   'public, s-maxage=3600, stale-while-revalidate=86400',
}

// Typed success response. Pass a CacheHint to opt in to edge caching on Vercel.
export function ok<T>(
  data: T,
  status: number = 200,
  cache: CacheHint = 'none',
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    { data, error: null },
    { status, headers: { 'Cache-Control': CACHE_HEADERS[cache] } },
  )
}

// Error response
export function err(message: string, status = 400): NextResponse {
  return NextResponse.json({ data: null, error: message }, { status })
}

// Generates a UUID string for QR tokens
export function generateQRToken(): string {
  return crypto.randomUUID()
}

// Derives a crowd label string from a percentage
export function crowdLabelFromPercent(
  pct: number
): 'empty' | 'quiet' | 'lively' | 'busy' | 'packed' {
  if (pct < 20) return 'empty'
  if (pct < 45) return 'quiet'
  if (pct < 65) return 'lively'
  if (pct < 85) return 'busy'
  return 'packed'
}

// Resolve an optional client-requested booking date (YYYY-MM-DD) for the
// Rumbalist flows. Absent/empty → tomorrow's night (the legacy default the
// web app relies on). Present → must be tonight…+14 nights, else null.
export function resolveBookingDate(requested: unknown, now: Date = new Date()): string | null {
  // Nights, in Madrid, with the 06:00 rollover (lib/hours.currentNight): at
  // 02:00 on Saturday "tonight" is still Friday. The old UTC arithmetic needed
  // a day of slack each side to cope, which also let a guest book a night that
  // had already ended.
  const tonight = currentNight(now)
  // Legacy default for callers that send no date (the web sheet): tomorrow.
  if (typeof requested !== 'string' || requested === '') {
    const d = new Date(`${tonight}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return null
  if (Number.isNaN(Date.parse(`${requested}T00:00:00Z`))) return null
  const ahead = nightsBetween(tonight, requested)
  return ahead >= 0 && ahead <= 14 ? requested : null
}

/**
 * Split a list of ids into chunks small enough for a PostgREST `.in()` filter.
 *
 * `.in()` is a GET query parameter, so every id is spelled out in the URL. A
 * UUID costs ~37 characters there; a few hundred of them run past what the
 * proxy in front of Postgres will accept, and the failure is a 414 that reads
 * like a server fault rather than "your list got long". The feed now carries
 * every upcoming night, so lists that used to be capped at 100 are unbounded.
 *
 * 100 keeps the longest filter near 4KB, well inside every limit in the path.
 */
export const ID_CHUNK = 100

export function chunked<T>(ids: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}
