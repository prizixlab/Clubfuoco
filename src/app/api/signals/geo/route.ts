import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

const RADIUS_M = 160  // how close counts as "at the venue"

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ── POST — the device's current location on app-open. ──────────────────────
// If it sits inside a venue's radius, log a geo_presence signal.
export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const lat = Number(body.lat), lng = Number(body.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return err('lat/lng required')

  const supabase = await createServiceClient()

  // Bounding box (~250m) around the device, then exact haversine inside.
  const dLat = 0.0025, dLng = 0.0033
  const { data: clubs, error } = await supabase
    .from('clubs')
    .select('id, name, lat, lng')
    .eq('is_active', true)
    .gte('lat', lat - dLat).lte('lat', lat + dLat)
    .gte('lng', lng - dLng).lte('lng', lng + dLng)

  if (error) return err(error.message)

  let nearest: { id: string; name: string; dist: number } | null = null
  for (const c of clubs ?? []) {
    if (c.lat == null || c.lng == null) continue
    const d = haversineM(lat, lng, c.lat, c.lng)
    if (d <= RADIUS_M && (!nearest || d < nearest.dist)) {
      nearest = { id: c.id, name: c.name, dist: d }
    }
  }
  if (!nearest) return ok({ matched: null })

  // Don't double-log the same venue within 4h.
  const since = new Date(Date.now() - 4 * 3600 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('venue_signals')
    .select('id')
    .eq('user_id', user!.id)
    .eq('club_id', nearest.id)
    .eq('kind', 'geo_presence')
    .gte('created_at', since)
    .limit(1)

  if (!recent?.length) {
    await supabase.from('venue_signals').insert({
      user_id:    user!.id,
      club_id:    nearest.id,
      kind:       'geo_presence',
      distance_m: Math.round(nearest.dist),
    })
  }

  return ok({ matched: { club_id: nearest.id, name: nearest.name, distance_m: Math.round(nearest.dist) } })
}
