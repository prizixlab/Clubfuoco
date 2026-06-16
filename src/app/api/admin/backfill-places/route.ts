import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireCronOrRole } from '@/lib/auth'
import { filterHotelPhotos, isHotel } from '@/lib/photo-filter'
import { venueShouldBeVisible, isFreeEntryVenue } from '@/lib/venue-classify'

const KEY  = process.env.GOOGLE_PLACES_API_KEY!
const BASE = 'https://maps.googleapis.com/maps/api/place'

/**
 * GET /api/admin/backfill-places?batch=50&offset=0
 *
 * For each active club that has no google_place_id (OSM-imported clubs),
 * this does a Google Places Text Search by name, then fetches photos and
 * stores the place_id + photos back to the DB.
 *
 * Run repeatedly with increasing offsets until done=true.
 * Safe to call multiple times — skips clubs that already have a place_id.
 *
 * Respects Google's ~10 QPS limit by processing sequentially with a small delay.
 */
export async function GET(req: NextRequest) {
  // Vercel cron (CRON_SECRET bearer) or a logged-in admin/staff member.
  const { response } = await requireCronOrRole(req, ['admin', 'staff'])
  if (response) return response

  const batch  = Math.min(parseInt(req.nextUrl.searchParams.get('batch')  ?? '30'), 100)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0')

  const supabase = await createServiceClient()

  // Fetch clubs without a google_place_id (and no photos)
  const { data: clubs, error, count } = await supabase
    .from('clubs')
    .select('id, name, lat, lng', { count: 'exact' })
    .eq('is_active', true)
    .is('google_place_id', null)
    .order('name')
    .range(offset, offset + batch - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = { found: 0, not_found: 0, errors: 0, total_remaining: count ?? 0 }

  for (const club of clubs ?? []) {
    try {
      // Text search by name + city — NO type filter: nightclubs are typed
      // as 'night_club', not 'bar', so filtering by type picks the wrong venue
      const q      = encodeURIComponent(`${club.name} Barcelona`)
      const srRes  = await fetch(`${BASE}/textsearch/json?query=${q}&key=${KEY}`)
      const srData = await srRes.json()
      const hit    = srData.results?.[0]

      if (!hit?.place_id) { results.not_found++; continue }

      // Sanity-check: the returned name should share at least one significant
      // word with our club name to avoid saving a completely wrong venue
      const ourWords = club.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
      const hitName  = (hit.name ?? '').toLowerCase()
      const nameMatch = ourWords.length === 0 || ourWords.some((w: string) => hitName.includes(w))
      if (!nameMatch) { results.not_found++; continue }

      const placeId = hit.place_id as string

      // Fetch full details: photos + rating + types (needed for hotel detection)
      const dtRes  = await fetch(
        `${BASE}/details/json?place_id=${placeId}&fields=photos,rating,user_ratings_total,opening_hours,types&key=${KEY}`
      )
      const dtData = await dtRes.json()
      const refs: string[] = (dtData.result?.photos ?? []).slice(0, 9).map((p: any) => p.photo_reference)
      let allUrls = refs.map(
        r => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${r}&key=${KEY}`
      )

      // For hotels, filter out room/pool/lobby photos — keep only bar photos
      if (isHotel(dtData.result?.types ?? [])) {
        allUrls = await filterHotelPhotos(allUrls)
      }

      const coverUrl  = allUrls[0] ?? null
      const extraUrls = allUrls.slice(1)

      const placeTypes: string[] = dtData.result?.types ?? []

      await supabase.from('clubs').update({
        google_place_id: placeId,
        cover_image_url: coverUrl,
        gallery_urls:    extraUrls,
        photos:          extraUrls,
        rating:          dtData.result?.rating               ?? null,
        ratings_total:   dtData.result?.user_ratings_total   ?? 0,
        opening_hours:   dtData.result?.opening_hours?.weekday_text ?? null,
        last_synced_at:  new Date().toISOString(),
        // Auto-classify the newly-identified venue.
        is_active:       venueShouldBeVisible(placeTypes),
        ...(isFreeEntryVenue(placeTypes) ? { general_entry_price: 0 } : {}),
      }).eq('id', club.id)

      results.found++
    } catch {
      results.errors++
    }

    // ~5 QPS to stay well under Google's 10 QPS limit (2 calls per club)
    await new Promise(r => setTimeout(r, 200))
  }

  const nextOffset = offset + batch
  const done       = nextOffset >= (count ?? 0)

  return NextResponse.json({
    ok: true,
    batch,
    offset,
    next_offset: done ? null : nextOffset,
    done,
    ...results,
  })
}
