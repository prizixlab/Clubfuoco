import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireCronOrRole } from '@/lib/auth'
import { filterHotelPhotos, isHotel } from '@/lib/photo-filter'
import {
  activeAfterBackfill, isFreeEntryVenue, nameMatch, distanceMeters,
} from '@/lib/venue-classify'
import { mirrorPhotoRefs } from '@/lib/mirror-photo'

const KEY  = process.env.GOOGLE_PLACES_API_KEY!
const BASE = 'https://maps.googleapis.com/maps/api/place'

// A name match is only trusted when the hit is also physically where we already
// believe the venue is. Name alone produces confident nonsense — "L'ideal" (a
// bar) strong-matches "IDEAL Centre d'Arts Digitals", and an exact "Bitàcora"
// sits 2.5 km from ours. In a dry run every TRUE match was ≤6 m and every false
// one ≥2.5 km, so the gate is generous without admitting the impostors. Applies
// to strong matches too, not just fuzzy ones.
const MATCH_MAX_METERS = 150

// Photos are mirrored into Supabase Storage (see mirrorPhotoRefs) so a venue
// view never calls Google. The raw Google URL is never stored — it embeds the
// API key and is served straight to clients (that leaked the old key).

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

  // Clubs still missing a google_place_id. is_active + cover come along so we
  // never demote a curated venue, nor clobber a hand-picked cover image.
  const { data: clubs, error, count } = await supabase
    .from('clubs')
    .select('id, name, lat, lng, is_active, cover_image_url', { count: 'exact' })
    .eq('is_active', true)
    .is('google_place_id', null)
    .order('name')
    .range(offset, offset + batch - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = { found: 0, not_found: 0, rejected: 0, duplicate: 0, errors: 0, total_remaining: count ?? 0 }
  const duplicates: { club: string; place_id: string }[] = []

  for (const club of clubs ?? []) {
    try {
      // Text search by name + city — NO type filter: nightclubs are typed
      // as 'night_club', not 'bar', so filtering by type picks the wrong venue
      const q      = encodeURIComponent(`${club.name} Barcelona`)
      const srRes  = await fetch(`${BASE}/textsearch/json?query=${q}&key=${KEY}`)
      const srData = await srRes.json()
      const hit    = srData.results?.[0]

      if (!hit?.place_id) { results.not_found++; continue }

      // Two independent signals must agree: the name has to plausibly match AND
      // the hit has to be where we already place the venue. Either alone saves
      // the wrong place_id + photos onto a real club.
      const tier = nameMatch(club.name, hit.name ?? '')
      if (tier === 'none') { results.rejected++; continue }

      const hitLoc = hit.geometry?.location
      const haveCoords = club.lat != null && club.lng != null && hitLoc
      if (haveCoords) {
        const d = distanceMeters({ lat: club.lat, lng: club.lng }, { lat: hitLoc.lat, lng: hitLoc.lng })
        if (d > MATCH_MAX_METERS) { results.rejected++; continue }
      } else if (tier !== 'strong') {
        // No coordinates to confirm with — only trust an exact/prefix name.
        results.rejected++; continue
      }

      const placeId = hit.place_id as string

      // Fetch full details: photos + rating + types (needed for hotel detection)
      const dtRes  = await fetch(
        `${BASE}/details/json?place_id=${placeId}&fields=photos,rating,user_ratings_total,opening_hours,types&key=${KEY}`
      )
      const dtData = await dtRes.json()
      const refs: string[] = (dtData.result?.photos ?? []).slice(0, 9).map((p: any) => p.photo_reference)
      // Mirror into our own storage so future views never call Google. Any
      // photo that fails to mirror falls back to the key-free proxy path.
      let allPaths = await mirrorPhotoRefs(club.id, refs)

      // For hotels, filter out room/pool/lobby photos — keep only bar photos
      if (isHotel(dtData.result?.types ?? [])) {
        allPaths = await filterHotelPhotos(allPaths)
      }

      const placeTypes: string[] = dtData.result?.types ?? []

      // Preserve a hand-picked cover (anything already set that isn't a Google
      // URL); only fall back to Google's first photo when there's nothing.
      const hasCuratedCover = !!club.cover_image_url &&
        !club.cover_image_url.includes('maps.googleapis.com')
      const cover = hasCuratedCover ? club.cover_image_url : (allPaths[0] ?? null)
      const gallery = hasCuratedCover ? allPaths : allPaths.slice(1)

      const { error: writeErr } = await supabase.from('clubs').update({
        google_place_id: placeId,
        cover_image_url: cover,
        gallery_urls:    gallery,
        photos:          allPaths,
        rating:          dtData.result?.rating               ?? null,
        ratings_total:   dtData.result?.user_ratings_total   ?? 0,
        opening_hours:   dtData.result?.opening_hours?.weekday_text ?? null,
        last_synced_at:  new Date().toISOString(),
        places_synced_at: new Date().toISOString(),
        // Enrichment may promote a hidden venue it now recognises as nightlife,
        // but must never turn OFF one a human already curated as active.
        is_active:       activeAfterBackfill(club.is_active, placeTypes),
        ...(isFreeEntryVenue(placeTypes) ? { general_entry_price: 0 } : {}),
      }).eq('id', club.id)

      if (writeErr) {
        // 23505: this place_id is already on another club — this row is a
        // DUPLICATE of a venue we hold. Surface it for a merge rather than
        // miscounting it as enriched or forcing a wrong place_id.
        if (writeErr.code === '23505') {
          results.duplicate++
          duplicates.push({ club: club.name, place_id: placeId })
        } else {
          results.errors++
        }
        continue
      }

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
    duplicates,
  })
}
