import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireCronOrRole } from '@/lib/auth'
import { filterHotelPhotos, isHotel } from '@/lib/photo-filter'

const KEY  = process.env.GOOGLE_PLACES_API_KEY!
const BASE = 'https://maps.googleapis.com/maps/api/place'

// Compute similarity score between two clubs based on shared tags
function similarity(tagsA: string[], tagsB: string[]): number {
  if (tagsA.length === 0 || tagsB.length === 0) return 0
  const setA = new Set(tagsA)
  const shared = tagsB.filter(t => setA.has(t)).length
  return shared / Math.sqrt(tagsA.length * tagsB.length) // Jaccard-like
}

// GET /api/admin/sync?batch=50&offset=0  — called by Vercel cron (or manually)
// Syncs clubs that have a google_place_id with fresh data from Google Places.
// Supports batch/offset pagination so large catalogs don't time out.
export async function GET(req: NextRequest) {
  // Vercel cron (CRON_SECRET bearer) or a logged-in admin/staff member.
  const { response } = await requireCronOrRole(req, ['admin', 'staff'])
  if (response) return response

  const batch  = Math.min(parseInt(req.nextUrl.searchParams.get('batch')  ?? '9999'), 200)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0')

  const supabase = await createServiceClient()

  const { data: clubs, error, count } = await supabase
    .from('clubs')
    .select('id, name, google_place_id', { count: 'exact' })
    .not('google_place_id', 'is', null)
    .order('name')
    .range(offset, offset + batch - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = { synced: 0, failed: 0, skipped: 0, total: count ?? 0 }

  for (const club of clubs ?? []) {
    if (!club.google_place_id) { results.skipped++; continue }

    try {
      const fields = [
        'name', 'formatted_address', 'geometry', 'opening_hours',
        'photos', 'rating', 'user_ratings_total', 'price_level', 'types', 'reviews',
      ].join(',')
      const res  = await fetch(`${BASE}/details/json?place_id=${club.google_place_id}&fields=${fields}&key=${KEY}`)
      const data = await res.json()
      if (data.status !== 'OK') { results.failed++; continue }

      const d = data.result
      const photoRefs: string[] = (d.photos ?? []).slice(0, 9).map((p: any) => p.photo_reference)
      let allUrls = photoRefs.map(ref =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${KEY}`
      )

      // For hotels, filter to bar/nightclub photos only using Gemini Vision
      if (isHotel(d.types ?? [])) {
        allUrls = await filterHotelPhotos(allUrls)
      }

      // Store cover separately; gallery_urls and photos hold only the extras
      // so merging them at read-time never produces duplicates
      const coverUrl   = allUrls[0] ?? null
      const extraUrls  = allUrls.slice(1)   // up to 8 additional

      // Normalise Google reviews into our storage shape
      const reviews = (d.reviews ?? []).slice(0, 10).map((r: any) => ({
        author:  r.author_name,
        avatar:  r.profile_photo_url ?? null,
        rating:  r.rating,
        time:    r.relative_time_description,
        text:    r.text,
        source:  'google',
      }))

      await supabase
        .from('clubs')
        .update({
          rating:          d.rating ?? null,
          ratings_total:   d.user_ratings_total ?? 0,
          opening_hours:   d.opening_hours?.weekday_text ?? null,
          cover_image_url: coverUrl,
          gallery_urls:    extraUrls,
          photos:          extraUrls,   // same list — avoids cover duplication at read time
          reviews,
          last_synced_at:  new Date().toISOString(),
        })
        .eq('id', club.id)

      results.synced++
    } catch {
      results.failed++
    }
  }

  const nextOffset = offset + batch
  const done       = nextOffset >= (count ?? 0)

  // Only recompute similarity scores on the final batch (or non-batched run)
  if (!done) {
    return NextResponse.json({ ok: true, ...results, next_offset: nextOffset, done: false })
  }

  // Recompute club similarity scores
  const { data: allTags } = await supabase
    .from('club_tags')
    .select('club_id, tag')

  if (allTags && allTags.length > 0) {
    // Group tags by club
    const tagsByClub: Record<string, string[]> = {}
    for (const row of allTags) {
      if (!tagsByClub[row.club_id]) tagsByClub[row.club_id] = []
      tagsByClub[row.club_id].push(row.tag)
    }

    const clubIds = Object.keys(tagsByClub)
    const similarityRows: { club_a: string; club_b: string; score: number; updated_at: string }[] = []

    for (let i = 0; i < clubIds.length; i++) {
      for (let j = i + 1; j < clubIds.length; j++) {
        const score = similarity(tagsByClub[clubIds[i]], tagsByClub[clubIds[j]])
        if (score > 0.1) {
          const now = new Date().toISOString()
          similarityRows.push({ club_a: clubIds[i], club_b: clubIds[j], score, updated_at: now })
          similarityRows.push({ club_a: clubIds[j], club_b: clubIds[i], score, updated_at: now })
        }
      }
    }

    if (similarityRows.length > 0) {
      await supabase
        .from('club_similarity')
        .upsert(similarityRows, { onConflict: 'club_a,club_b' })
    }
  }

  return NextResponse.json({ ok: true, ...results, done: true })
}
