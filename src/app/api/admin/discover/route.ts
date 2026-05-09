import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const KEY  = process.env.GOOGLE_PLACES_API_KEY!
const BASE = 'https://maps.googleapis.com/maps/api/place'

// Google Place types that strongly indicate a nightlife venue
const NIGHTLIFE_TYPES = new Set(['bar', 'night_club'])

const DISCOVERY_QUERIES = [
  'nightclub Barcelona',
  'bar Barcelona Eixample',
  'bar Barcelona Barceloneta',
  'club Barcelona Poblenou',
  'cocktail bar Barcelona',
  'lounge bar Barcelona',
  'disco Barcelona',
  'bar de copas Barcelona',
  'sala de fiestas Barcelona',
  'beach club Barcelona',
  'rooftop bar Barcelona',
  'jazz bar Barcelona',
  'techno club Barcelona',
]

function toSlug(name: string) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// GET /api/admin/discover
// Step 1: Import everything from Google Places with nightlife types immediately — no AI gate.
// Step 2: Gemini cleanup runs separately (/api/admin/cleanup) and removes bad ones later.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isCron     = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isManual   = req.nextUrl.searchParams.get('manual') === '1'
  if (!isCron && !isManual) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // Skip place IDs we already have
  const { data: existing } = await supabase
    .from('clubs')
    .select('google_place_id')
    .not('google_place_id', 'is', null)

  const knownIds = new Set((existing ?? []).map(c => c.google_place_id))

  // Rotate query batch each day so we cover different searches over time
  const batchSize  = 3
  const day        = Math.floor(Date.now() / 86_400_000)
  const batchStart = (day % Math.ceil(DISCOVERY_QUERIES.length / batchSize)) * batchSize
  const queryBatch = DISCOVERY_QUERIES.slice(batchStart, batchStart + batchSize)

  const candidates: any[] = []
  for (const query of queryBatch) {
    try {
      const res  = await fetch(`${BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${KEY}`, { cache: 'no-store' })
      const data = await res.json()
      for (const r of data.results ?? []) {
        const hasNightlifeType = (r.types ?? []).some((t: string) => NIGHTLIFE_TYPES.has(t))
        if (hasNightlifeType && !knownIds.has(r.place_id) && !candidates.some(c => c.place_id === r.place_id)) {
          candidates.push(r)
          knownIds.add(r.place_id)
        }
      }
    } catch { /* skip failed query */ }
  }

  const results = { added: 0, skipped: 0, errors: 0 }

  // Import all candidates immediately — no AI gating
  for (const venue of candidates) {
    try {
      const photos = (venue.photos ?? []).slice(0, 5).map((p: any) =>
        `${BASE}/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${KEY}`
      )

      const { error } = await supabase
        .from('clubs')
        .insert({
          name:            venue.name,
          slug:            toSlug(venue.name),
          address:         venue.formatted_address ?? venue.vicinity ?? '',
          lat:             venue.geometry?.location?.lat ?? null,
          lng:             venue.geometry?.location?.lng ?? null,
          cover_image_url: photos[0] ?? null,
          gallery_urls:    photos.slice(1),
          rating:          venue.rating ?? null,
          ratings_total:   venue.user_ratings_total ?? 0,
          google_place_id: venue.place_id,
          photos,
          is_active:       true,
          is_featured:     false,
          is_partner:      false,
          // last_synced_at intentionally null — signals Gemini cleanup hasn't run yet
        })

      if (error) { results.errors++; continue }
      results.added++
    } catch {
      results.errors++
    }
  }

  console.log(`[discover] Added ${results.added} venues. Gemini cleanup will run separately.`)
  return NextResponse.json({ ok: true, candidates: candidates.length, ...results })
}
