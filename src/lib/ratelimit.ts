// Best-effort, in-memory fixed-window rate limiter.
//
// NOTE: serverless functions don't share memory across instances, so this caps
// abuse *per warm instance*, not globally. It's a cheap first line of defence
// for public, unauthenticated endpoints (e.g. invite previews) to blunt naive
// brute-forcing. For hard global limits, move to Vercel KV / Upstash Redis.
type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

/** Returns true if the key is allowed, false if it has exceeded `limit` per `windowMs`. */
export function rateLimit(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    // Opportunistic cleanup so the map can't grow unbounded.
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k)
    }
    return true
  }

  if (existing.count >= limit) return false
  existing.count += 1
  return true
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
