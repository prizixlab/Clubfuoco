import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Edge runtime: pure-read, no Node-only APIs. Halves cold-start latency.
export const runtime = 'edge'

// Barcelona city centre — fallback when no GPS given
const BCN_LAT = 41.385
const BCN_LNG = 2.173

// Google Places photo URLs must be fetched server-side.
// Convert any stored Google URL to our own proxy route so the browser
// never calls maps.googleapis.com directly (which Google blocks client-side).
function proxyPhoto(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.includes('maps.googleapis.com/maps/api/place/photo')) {
    try {
      const ref = new URL(url).searchParams.get('photo_reference')
      if (ref) return `/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=800`
    } catch { /* fall through */ }
  }
  return url // already a relative/proxy URL or other CDN
}

/**
 * GET /api/places/nearby?lat=&lng=&radius=
 *
 * Returns clubs from our own database — no Google API calls.
 * Filters by bounding box around the user's location (or all of Barcelona
 * if no coords given). Returns up to 300 venues ordered by featured → rating.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const lat    = parseFloat(searchParams.get('lat') ?? String(BCN_LAT))
  const lng    = parseFloat(searchParams.get('lng') ?? String(BCN_LNG))
  const radius = parseFloat(searchParams.get('radius') ?? '5000') // metres

  // Rough degree deltas for the bounding box
  // 1° lat ≈ 111 km  |  1° lng ≈ 85 km at Barcelona latitude (~41°)
  const latDelta = radius / 111_000
  const lngDelta = radius / 85_000

  const supabase = await createServiceClient()

  const { data: clubs, error } = await supabase
    .from('clubs')
    .select(`
      id, name, slug, address, neighborhood,
      lat, lng, cover_image_url, gallery_urls, photos,
      rating, ratings_total, music_genres, google_place_id,
      general_entry_price, vip_table_min_spend,
      is_featured, is_partner,
      live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ),
      club_tags ( tag, category )
    `)
    .eq('is_active', true)
    .not('lat', 'is', null)
    .gte('lat', lat - latDelta).lte('lat', lat + latDelta)
    .gte('lng', lng - lngDelta).lte('lng', lng + lngDelta)
    .order('is_featured',    { ascending: false })
    .order('is_partner',     { ascending: false })
    .order('ratings_total',  { ascending: false, nullsFirst: false })
    .order('rating',         { ascending: false, nullsFirst: false })
    .limit(2000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = (clubs ?? []).map(club => {
    const tags: string[] = (club.club_tags ?? []).map((t: any) => t.tag)

    // Build photo list — deduplicate across all sources, proxy Google URLs
    const photoSeen = new Set<string>()
    const allPhotos: string[] = [
      ...(club.cover_image_url ? [club.cover_image_url] : []),
      ...(Array.isArray(club.photos)       ? club.photos       : []),
      ...(Array.isArray(club.gallery_urls) ? club.gallery_urls : []),
    ]
      .filter(Boolean)
      .map(proxyPhoto)
      .filter((url): url is string => {
        if (!url || photoSeen.has(url)) return false
        photoSeen.add(url)
        return true
      })
      .slice(0, 8)

    return {
      place_id:       club.id,             // our UUID — used in URLs & links
      name:           club.name,
      slug:           club.slug,
      address:        club.address ?? '',
      neighborhood:   club.neighborhood ?? null,
      lat:            club.lat  ?? 0,
      lng:            club.lng  ?? 0,
      rating:         club.rating        ?? null,
      ratings_total:  club.ratings_total ?? 0,
      price_level:    null,                // not stored yet; kept for type compat
      is_open:        (club.live_status as any)?.is_open ?? null,
      live_status:    club.live_status   ?? null,
      music_genres:   club.music_genres  ?? [],
      tags,
      google_place_id: club.google_place_id ?? null,
      is_featured:    club.is_featured,
      is_partner:     club.is_partner,
      general_entry_price: club.general_entry_price ?? null,
      vip_table_min_spend: club.vip_table_min_spend ?? null,
      cover_photo:    allPhotos[0] ?? null,
      photos:         allPhotos,
      photo_refs:     [],   // kept for backward compat
      website:        null,
      maps_url: club.google_place_id
        ? `https://www.google.com/maps/place/?q=place_id:${club.google_place_id}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.name + ' Barcelona')}`,
    }
  })

  return NextResponse.json({ data: results }, {
    headers: {
      // Public reference data — clubs change rarely outside of nightly cron.
      // Edge cache 5min, serve stale up to 10min while revalidating.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      // Vary by query so different (lat,lng,radius) tuples cache separately.
      'Vary': 'Accept-Encoding',
    },
  })
}
