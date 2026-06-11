// ─────────────────────────────────────────────────────────────────────────────
// neighborhood-fill.mjs — DRY RUN. Derives each club's neighborhood (barri) from
// its existing lat/lng using Barcelona's official neighborhood boundaries
// (point-in-polygon). No external venue data, no API key, 100% coverage for
// venues inside the city. Writes scripts/neighborhood-fill-report.json. No DB writes.
//
// Run:  node --env-file=.env.local scripts/neighborhood-fill.mjs
//
// Boundaries: Barcelona Open Data — "Unitats Administratives: Barris".
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase env. Run with --env-file=.env.local')
  process.exit(1)
}
const GEOJSON_URL = 'https://raw.githubusercontent.com/martgnz/bcn-geodata/master/barris/barris.geojson'

// ── point-in-polygon (ray casting) ───────────────────────────────────────────
function inRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const hit = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    if (hit) inside = !inside
  }
  return inside
}

// polygon = array of rings: [outer, hole1, ...]
function inPolygon(lng, lat, polygon) {
  if (!inRing(lng, lat, polygon[0])) return false
  for (let h = 1; h < polygon.length; h++) {
    if (inRing(lng, lat, polygon[h])) return false // inside a hole
  }
  return true
}

function buildBarris(geojson) {
  const barris = []
  for (const f of geojson.features) {
    const name = f.properties.NOM
    const district = f.properties.DISTRICTE
    const g = f.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates
      : []
    barris.push({ name, district, polys })
  }
  return barris
}

function locate(lng, lat, barris) {
  for (const b of barris) {
    for (const poly of b.polys) {
      if (inPolygon(lng, lat, poly)) return b.name
    }
  }
  return null
}

// ── main ─────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

console.log('Fetching Barcelona neighborhood boundaries…')
const geo = await fetch(GEOJSON_URL).then(r => {
  if (!r.ok) throw new Error(`GeoJSON HTTP ${r.status}`)
  return r.json()
})
const barris = buildBarris(geo)
console.log(`  ${barris.length} neighborhoods loaded`)

console.log('Fetching clubs…')
const { data: clubs, error } = await supabase
  .from('clubs')
  .select('id, name, lat, lng, neighborhood')
if (error) { console.error('DB error:', error.message); process.exit(1) }
console.log(`  ${clubs.length} clubs`)

const proposals = []
const noCoords = []
const outside = []

for (const club of clubs) {
  const hasNb = club.neighborhood != null && club.neighborhood !== ''
  if (hasNb) continue
  if (club.lat == null || club.lng == null) { noCoords.push({ id: club.id, name: club.name }); continue }

  const nb = locate(Number(club.lng), Number(club.lat), barris)
  if (!nb) { outside.push({ id: club.id, name: club.name, lat: club.lat, lng: club.lng }); continue }

  proposals.push({ club_id: club.id, club_name: club.name, neighborhood: nb })
}

const report = {
  generated_at: new Date().toISOString(),
  source: 'Barcelona Open Data — Barris (official neighborhood boundaries)',
  method: 'point-in-polygon on existing club lat/lng',
  totals: {
    clubs: clubs.length,
    missing_neighborhood: clubs.filter(c => !c.neighborhood).length,
    filled: proposals.length,
    no_coords: noCoords.length,
    outside_barcelona: outside.length,
  },
  proposals,
  no_coords: noCoords,
  outside_barcelona: outside,
}

writeFileSync(new URL('./neighborhood-fill-report.json', import.meta.url), JSON.stringify(report, null, 2))

console.log('\n── Summary ────────────────────────────────')
console.log(`  Filled: ${proposals.length}`)
console.log(`  Outside BCN boundaries: ${outside.length}`)
console.log(`  No coords: ${noCoords.length}`)
console.log('  Wrote scripts/neighborhood-fill-report.json — review before applying.')
console.log('────────────────────────────────────────────')

// Show the distribution so it's easy to sanity-check
const dist = {}
for (const p of proposals) dist[p.neighborhood] = (dist[p.neighborhood] || 0) + 1
const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log('\n  Top neighborhoods:')
for (const [n, c] of top) console.log(`    ${String(c).padStart(3)}  ${n}`)
