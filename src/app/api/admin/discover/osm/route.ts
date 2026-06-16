import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireCronOrRole } from '@/lib/auth'

// OpenStreetMap Overpass API — completely free, no key needed
// Barcelona bounding box: south, west, north, east
const BBOX = '41.30,2.05,41.47,2.25'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// OSM amenity values we want
const NIGHTLIFE_AMENITIES = new Set([
  'bar', 'nightclub', 'pub', 'biergarten', 'cocktail_bar',
])

// OSM values we explicitly skip (restaurants, cafes, etc.)
const SKIP_AMENITIES = new Set([
  'restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream',
])

function toSlug(name: string) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function buildAddress(tags: Record<string, string>): string {
  const parts = [
    tags['addr:street'] && tags['addr:housenumber']
      ? `${tags['addr:street']} ${tags['addr:housenumber']}`
      : tags['addr:street'] ?? '',
    tags['addr:city'] ?? tags['addr:suburb'] ?? 'Barcelona',
    tags['addr:postcode'] ?? '',
  ].filter(Boolean)
  return parts.join(', ') || tags['addr:full'] || ''
}

/**
 * GET /api/admin/discover/osm
 *
 * Bulk-imports Barcelona nightlife venues from OpenStreetMap via the
 * Overpass API. Completely free — no Google API costs.
 * Deduplicates against existing clubs by name slug.
 * Newly inserted clubs have last_synced_at=null so Gemini cleanup reviews them.
 */
export async function GET(req: NextRequest) {
  // Vercel cron (CRON_SECRET bearer) or a logged-in admin/staff member.
  const { response } = await requireCronOrRole(req, ['admin', 'staff'])
  if (response) return response

  // Overpass QL — fetch nodes AND ways (some venues mapped as polygons)
  const query = `
[out:json][timeout:60];
(
  node["amenity"="bar"](${BBOX});
  node["amenity"="nightclub"](${BBOX});
  node["amenity"="pub"](${BBOX});
  node["amenity"="cocktail_bar"](${BBOX});
  node["amenity"="biergarten"](${BBOX});
  way["amenity"="bar"](${BBOX});
  way["amenity"="nightclub"](${BBOX});
  way["amenity"="pub"](${BBOX});
  way["amenity"="cocktail_bar"](${BBOX});
);
out center;
`.trim()

  const osmRes = await fetch(OVERPASS_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   'ClubFuoco/1.0 (contact@clubfuoco.com)',
    },
    body: new URLSearchParams({ data: query }).toString(),
  })

  if (!osmRes.ok) {
    return NextResponse.json({ error: `Overpass API error: ${osmRes.status}` }, { status: 502 })
  }

  const osmData = await osmRes.json()
  const elements: any[] = osmData.elements ?? []

  // Load existing slugs so we can deduplicate
  const supabase = await createServiceClient()
  const { data: existing } = await supabase.from('clubs').select('slug')
  const knownSlugs = new Set((existing ?? []).map(c => c.slug))

  const results = { total_osm: elements.length, added: 0, skipped: 0, errors: 0 }
  const inserted: string[] = []

  for (const el of elements) {
    const tags: Record<string, string> = el.tags ?? {}
    const name = tags.name ?? tags['name:en'] ?? tags['name:es'] ?? ''
    if (!name) { results.skipped++; continue }

    // Skip explicit non-nightlife amenities that slipped in
    const amenity = tags.amenity ?? ''
    if (SKIP_AMENITIES.has(amenity)) { results.skipped++; continue }

    // Skip if no recognisable nightlife amenity
    if (!NIGHTLIFE_AMENITIES.has(amenity)) { results.skipped++; continue }

    const slug = toSlug(name)
    if (!slug) { results.skipped++; continue }

    // Deduplicate by slug
    if (knownSlugs.has(slug)) { results.skipped++; continue }
    knownSlugs.add(slug)

    // lat/lng: nodes have them directly; ways have a center
    const lat = el.lat ?? el.center?.lat ?? null
    const lng = el.lon ?? el.center?.lon ?? null

    const address = buildAddress(tags)
    const website  = tags.website ?? tags['contact:website'] ?? null
    const phone    = tags.phone   ?? tags['contact:phone']   ?? null
    const hours    = tags.opening_hours ?? null

    const { error } = await supabase.from('clubs').insert({
      name,
      slug,
      address,
      lat,
      lng,
      is_active:    true,
      is_featured:  false,
      is_partner:   false,
      // leave last_synced_at null → Gemini cleanup will review it
    })

    if (error) {
      // Slug conflict race — skip silently
      if (error.code === '23505') { results.skipped++; continue }
      results.errors++
      console.error(`[osm] insert error for "${name}":`, error.message)
      continue
    }

    results.added++
    inserted.push(name)
  }

  console.log(`[osm] Done. OSM total=${results.total_osm} added=${results.added} skipped=${results.skipped} errors=${results.errors}`)
  return NextResponse.json({ ok: true, ...results, sample: inserted.slice(0, 20) })
}
