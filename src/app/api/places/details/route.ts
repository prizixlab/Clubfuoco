import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { filterHotelPhotos, isHotel } from '@/lib/photo-filter'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function proxyPhoto(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.includes('maps.googleapis.com/maps/api/place/photo')) {
    try {
      const ref = new URL(url).searchParams.get('photo_reference')
      if (ref) return `/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=800`
    } catch { /* fall through */ }
  }
  return url
}

/**
 * GET /api/places/details?id=<uuid-or-google-place-id>
 *
 * Looks up a club from our own database.
 * Accepts our UUID (primary) or a Google place_id (legacy — kept so
 * old saved favourites still resolve).
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createServiceClient()

  const isUUID = UUID_RE.test(id)

  const baseQuery = supabase
    .from('clubs')
    .select(`
      id, name, slug, address, neighborhood,
      lat, lng, cover_image_url, gallery_urls, photos,
      rating, ratings_total, music_genres, google_place_id,
      description, instagram_handle, whatsapp_link,
      general_entry_price, vip_table_min_spend,
      opening_hours, is_featured, is_partner, is_active,
      reviews,
      live_status (*),
      club_tags ( tag, category )
    `)

  const { data: club, error } = await (isUUID
    ? baseQuery.eq('id', id)
    : baseQuery.eq('google_place_id', id)
  ).maybeSingle()

  if (error)  return NextResponse.json({ error: error.message }, { status: 500 })
  if (!club)  return NextResponse.json({ error: 'Not found' },   { status: 404 })

  const tags: string[] = (club.club_tags ?? []).map((t: any) => t.tag)

  // Merge all photo sources and deduplicate by URL
  const seen = new Set<string>()
  const allPhotos: string[] = [
    ...(club.cover_image_url ? [club.cover_image_url] : []),
    ...(Array.isArray(club.photos)       ? club.photos       : []),
    ...(Array.isArray(club.gallery_urls) ? club.gallery_urls : []),
  ]
    .filter(Boolean)
    .map(proxyPhoto)
    .filter((url): url is string => {
      if (!url || seen.has(url)) return false
      seen.add(url)
      return true
    })

  const KEY = process.env.GOOGLE_PLACES_API_KEY

  // If we have fewer than 3 photos and there's a stored place_id, top up from Google
  if (allPhotos.length < 3 && club.google_place_id && KEY) {
    try {
      const gRes  = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${club.google_place_id}&fields=photos,types&key=${KEY}`
      )
      const gData = await gRes.json()
      const refs: string[] = (gData.result?.photos ?? []).map((p: any) => p.photo_reference)
      let rawUrls = refs.map(
        r => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${r}&key=${KEY}`
      )
      if (isHotel(gData.result?.types ?? [])) {
        rawUrls = await filterHotelPhotos(rawUrls)
      }
      for (const raw of rawUrls) {
        if (allPhotos.length >= 3) break
        const ref      = new URL(raw).searchParams.get('photo_reference') ?? ''
        const proxyUrl = `/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=800`
        if (!seen.has(proxyUrl)) { seen.add(proxyUrl); allPhotos.push(proxyUrl) }
      }
    } catch { /* non-critical */ }
  }

  // No place_id at all (OSM-imported clubs) — text-search Google once, cache the result
  if (allPhotos.length < 1 && !club.google_place_id && KEY) {
    try {
      const q       = encodeURIComponent(`${club.name} Barcelona`)
      const srRes   = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${KEY}`
      )
      const srData  = await srRes.json()
      // Sanity-check name so we don't save a neighbouring bar's photos
      const ourWords = club.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
      const hit      = (srData.results ?? []).find((r: any) => {
        if (!r.place_id) return false
        if (ourWords.length === 0) return true
        const rName = (r.name ?? '').toLowerCase()
        return ourWords.some((w: string) => rName.includes(w))
      })
      if (hit?.place_id) {
        const placeId = hit.place_id as string

        // Get photos from the found place (also fetch types for hotel detection)
        const dtRes  = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos,name,rating,user_ratings_total,types&key=${KEY}`
        )
        const dtData = await dtRes.json()
        const refs: string[] = (dtData.result?.photos ?? []).slice(0, 9).map((p: any) => p.photo_reference)

        // Raw Google URLs — needed for Gemini Vision filtering (server-side only)
        let rawUrls = refs.map(
          r => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${r}&key=${KEY}`
        )

        // For hotels, filter to bar/nightclub photos only
        if (isHotel(dtData.result?.types ?? [])) {
          rawUrls = await filterHotelPhotos(rawUrls)
        }

        // Now convert raw Google URLs → proxy URLs for client delivery
        const proxyUrls = rawUrls.map(
          raw => `/api/places/photo?ref=${encodeURIComponent(new URL(raw).searchParams.get('photo_reference') ?? '')}&maxwidth=800`
        )

        const coverUrl  = proxyUrls[0] ?? null
        const extraUrls = proxyUrls.slice(1)

        // Persist so every future load is free (nightly sync will also pick it up)
        await supabase.from('clubs').update({
          google_place_id: placeId,
          cover_image_url: coverUrl,
          gallery_urls:    extraUrls,
          photos:          extraUrls,
          rating:          dtData.result?.rating          ?? club.rating,
          ratings_total:   dtData.result?.user_ratings_total ?? club.ratings_total,
        }).eq('id', club.id)

        for (const url of [coverUrl, ...extraUrls]) {
          if (!url || allPhotos.length >= 3 || seen.has(url)) continue
          seen.add(url)
          allPhotos.push(url)
        }
      }
    } catch { /* non-critical */ }
  }

  // ── Reviews ────────────────────────────────────────────────────────────────
  // Use stored reviews; if none yet and we have a place_id, fetch & store them
  let reviews: any[] = Array.isArray((club as any).reviews) ? (club as any).reviews : []

  if (reviews.length === 0 && club.google_place_id && KEY) {
    try {
      const rRes  = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${club.google_place_id}&fields=reviews&key=${KEY}`
      )
      const rData = await rRes.json()
      if (rData.status === 'OK' && rData.result?.reviews?.length) {
        reviews = rData.result.reviews.slice(0, 10).map((r: any) => ({
          author:  r.author_name,
          avatar:  r.profile_photo_url ?? null,
          rating:  r.rating,
          time:    r.relative_time_description,
          text:    r.text,
          source:  'google',
        }))
        // Persist so the next request doesn't need to hit Google
        await supabase.from('clubs').update({ reviews }).eq('id', club.id)
      }
    } catch { /* non-critical */ }
  }

  return NextResponse.json({
    data: {
      place_id:       club.id,
      name:           club.name,
      slug:           club.slug,
      address:        club.address ?? '',
      neighborhood:   club.neighborhood ?? null,
      lat:            club.lat  ?? null,
      lng:            club.lng  ?? null,
      description:    club.description ?? null,
      instagram_handle: club.instagram_handle ?? null,
      whatsapp_link:  club.whatsapp_link ?? null,
      phone:          null,
      website:        null,
      rating:         club.rating        ?? null,
      ratings_total:  club.ratings_total ?? 0,
      price_level:    null,
      is_open:        (club.live_status as any)?.is_open ?? null,
      live_status:    club.live_status ?? null,
      weekday_hours:  club.opening_hours ? [club.opening_hours] : [],
      music_genres:   club.music_genres  ?? [],
      tags,
      google_place_id: club.google_place_id ?? null,
      is_partner:     club.is_partner,
      is_featured:    club.is_featured,
      general_entry_price: club.general_entry_price ?? null,
      vip_table_min_spend: club.vip_table_min_spend ?? null,
      reviews,
      photos:         allPhotos,
      cover_photo:    allPhotos[0] ?? null,
      maps_url: club.google_place_id
        ? `https://www.google.com/maps/place/?q=place_id:${club.google_place_id}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.name + ' Barcelona')}`,
    },
  })
}
