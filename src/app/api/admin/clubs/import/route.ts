import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { venueShouldBeVisible, isFreeEntryVenue } from '@/lib/venue-classify'

const KEY  = process.env.GOOGLE_PLACES_API_KEY!
const BASE = 'https://maps.googleapis.com/maps/api/place'

// Derive club tags from Google Places types + name
function deriveTags(name: string, types: string[], priceLevel: number | null): { tag: string; category: string }[] {
  const tags: { tag: string; category: string }[] = []
  const n = name.toLowerCase()

  // Venue type
  if (types.includes('night_club') || n.includes('club') || n.includes('disco')) tags.push({ tag: 'nightclub',   category: 'venue_type' })
  if (types.includes('bar'))                                                       tags.push({ tag: 'bar',         category: 'venue_type' })
  if (n.includes('rooftop') || n.includes('terrace') || n.includes('terraza'))    tags.push({ tag: 'rooftop',     category: 'venue_type' })
  if (n.includes('lounge'))                                                        tags.push({ tag: 'lounge',      category: 'venue_type' })
  if (n.includes('cocktail') || n.includes('coctel'))                             tags.push({ tag: 'cocktail_bar',category: 'venue_type' })
  if (types.includes('restaurant') && !types.includes('night_club'))              tags.push({ tag: 'restaurant',  category: 'venue_type' })

  // Music vibes from name
  if (n.includes('techno') || n.includes('input') || n.includes('nitsa'))         tags.push({ tag: 'techno',      category: 'music' })
  if (n.includes('house') || n.includes('pacha'))                                 tags.push({ tag: 'house',       category: 'music' })
  if (n.includes('latin') || n.includes('salsa') || n.includes('reggaeton'))      tags.push({ tag: 'latin',       category: 'music' })
  if (n.includes('jazz') || n.includes('blues'))                                  tags.push({ tag: 'jazz',        category: 'music' })
  if (n.includes('indie') || n.includes('apolo') || n.includes('razzmatazz'))     tags.push({ tag: 'indie',       category: 'music' })
  if (n.includes('hip') || n.includes('hop') || n.includes('urban') || n.includes('sutton')) tags.push({ tag: 'hip_hop', category: 'music' })
  if (n.includes('edm') || n.includes('electronic'))                              tags.push({ tag: 'electronic',  category: 'music' })

  // Price vibes
  if (priceLevel !== null) {
    if (priceLevel <= 1) tags.push({ tag: 'budget',    category: 'vibe' })
    if (priceLevel === 2) tags.push({ tag: 'mid_range', category: 'vibe' })
    if (priceLevel >= 3) tags.push({ tag: 'upscale',   category: 'vibe' })
  }

  return tags
}

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// POST /api/admin/clubs/import
// Body: { place_id: string }  — imports a Google Place as a club
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) return err('Forbidden', 403)

  const { place_id } = await req.json()
  if (!place_id) return err('place_id required')

  // Check not already imported
  const { data: existing } = await supabase.from('clubs').select('id').eq('google_place_id', place_id).maybeSingle()
  if (existing) return err('Club already imported', 409)

  // Fetch full details from Google Places
  const fields = [
    'name', 'formatted_address', 'geometry', 'opening_hours',
    'photos', 'rating', 'user_ratings_total', 'price_level',
    'formatted_phone_number', 'website', 'types',
  ].join(',')
  const res  = await fetch(`${BASE}/details/json?place_id=${place_id}&fields=${fields}&key=${KEY}`)
  const data = await res.json()
  if (data.status !== 'OK') return err(`Google Places error: ${data.status}`, 502)

  const d = data.result
  const photoRefs: string[] = (d.photos ?? []).slice(0, 8).map((p: any) => p.photo_reference)
  const photos = photoRefs.map(ref =>
    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${KEY}`
  )

  const tags = deriveTags(d.name, d.types ?? [], d.price_level ?? null)
  const slug = toSlug(d.name)

  // Insert club
  const { data: club, error: clubErr } = await supabase
    .from('clubs')
    .insert({
      name:             d.name,
      slug,
      address:          d.formatted_address,
      lat:              d.geometry?.location?.lat,
      lng:              d.geometry?.location?.lng,
      cover_image_url:  photos[0] ?? null,
      gallery_urls:     photos.slice(1),
      rating:           d.rating ?? null,
      ratings_total:    d.user_ratings_total ?? 0,
      opening_hours:    d.opening_hours?.weekday_text ?? null,
      google_place_id:  place_id,
      last_synced_at:   new Date().toISOString(),
      // Auto-classify: nightlife/unknown venues are shown; confirmed
      // non-nightlife (restaurants, cafes, …) are imported but hidden.
      is_active:        venueShouldBeVisible(d.types ?? []),
      is_featured:      false,
      is_partner:       false,
      // Plain bars have free entry; night clubs charge a door (left null).
      general_entry_price: isFreeEntryVenue(d.types ?? []) ? 0 : null,
      photos:           photos,
    })
    .select()
    .single()

  if (clubErr) return err(clubErr.message)

  // Insert derived tags
  if (tags.length > 0) {
    await supabase.from('club_tags').insert(
      tags.map(t => ({ club_id: club.id, ...t }))
    )
  }

  return ok(club, 201)
}
