import { NextResponse } from 'next/server'
import type { ApiResponse } from '@/types'

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
// Rumbalist flows. Absent/empty → tomorrow (the legacy default the web app
// relies on). Present → must parse and fall within today…+14 days (UTC-day
// comparison, generous by a day across timezones), else null → reject.
export function resolveBookingDate(requested: unknown): string | null {
  const fallback = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
  if (typeof requested !== 'string' || requested === '') return fallback
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return null
  const picked = new Date(`${requested}T00:00:00Z`).getTime()
  if (Number.isNaN(picked)) return null
  const today = new Date()
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const diffDays = Math.floor((picked - todayUTC) / 86_400_000)
  // `requested` is a LOCAL calendar date; the client's local "today" can be a
  // day off from UTC today in either direction (offsets span UTC±14). Without
  // this tolerance a same-night claim after UTC midnight (e.g. 22:00 in
  // Barcelona → 00:00Z) is wrongly rejected. Keep the 14-day product window but
  // allow one day of slack on each side to absorb the timezone boundary.
  return diffDays >= -1 && diffDays <= 15 ? requested : null
}
