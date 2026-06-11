// ─────────────────────────────────────────────────────────────────────────────
// osm-fill.mjs — DRY RUN. Fills missing venue data from OpenStreetMap (free, no
// API key) for Barcelona clubs. Reads `clubs`, matches against Overpass, and
// writes a review file (scripts/osm-fill-report.json). Touches NOTHING in the DB.
//
// Run:  node --env-file=.env.local scripts/osm-fill.mjs
//
// Data © OpenStreetMap contributors, ODbL. Keep that attribution if you ship
// anything derived from this.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Run with --env-file=.env.local')
  process.exit(1)
}

// Barcelona bounding box (south, west, north, east)
const BBOX = [41.32, 2.07, 41.47, 2.23]

// ── helpers ──────────────────────────────────────────────────────────────────
function norm(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|el|la|los|las|de|del|club|discoteca|disco|bar|pub|lounge|sala|cafe|cocktail)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat), lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

function buildAddress(tags) {
  const street = tags['addr:street']
  const num = tags['addr:housenumber']
  if (street && num) return `${street}, ${num}`
  return street || null
}

function osmFields(el) {
  const tags = el.tags || {}
  const lat = el.lat ?? el.center?.lat ?? null
  const lng = el.lon ?? el.center?.lon ?? null
  const insta = (tags['contact:instagram'] || tags['instagram'] || '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/$/, '') || null
  return {
    name: tags.name || null,
    lat, lng,
    address: buildAddress(tags),
    neighborhood: tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['neighbourhood'] || null,
    instagram_handle: insta,
  }
}

// ── fetch OSM venues ─────────────────────────────────────────────────────────
async function fetchOSM() {
  const [s, w, n, e] = BBOX
  const ql = `[out:json][timeout:90];
(
  nwr["amenity"="nightclub"](${s},${w},${n},${e});
  nwr["amenity"="bar"](${s},${w},${n},${e});
  nwr["amenity"="pub"](${s},${w},${n},${e});
  nwr["club"="music"](${s},${w},${n},${e});
);
out center tags;`

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ]
  let json = null
  let lastErr = ''
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass requires an identifying User-Agent or it 406/429s.
          'User-Agent': 'ClubFuoco-venue-fill/1.0 (one-off data backfill)',
          'Accept': 'application/json',
        },
        body: 'data=' + encodeURIComponent(ql),
      })
      if (!res.ok) { lastErr = `HTTP ${res.status} from ${url}`; continue }
      json = await res.json()
      break
    } catch (e) {
      lastErr = `${url}: ${e.message}`
    }
  }
  if (!json) throw new Error(`All Overpass endpoints failed — ${lastErr}`)
  return (json.elements || [])
    .map(el => ({ id: `${el.type}/${el.id}`, ...osmFields(el) }))
    .filter(o => o.name && o.lat && o.lng)
}

// ── main ─────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

console.log('Fetching clubs from Supabase…')
const { data: clubs, error } = await supabase
  .from('clubs')
  .select('id, name, address, neighborhood, lat, lng, instagram_handle, is_active')
if (error) { console.error('DB error:', error.message); process.exit(1) }
console.log(`  ${clubs.length} clubs`)

console.log('Fetching Barcelona venues from OpenStreetMap (Overpass)…')
const osm = await fetchOSM()
console.log(`  ${osm.length} OSM venues with name + coords`)

// Index OSM by normalized name
const byNorm = new Map()
for (const o of osm) {
  const k = norm(o.name)
  if (!k) continue
  if (!byNorm.has(k)) byNorm.set(k, [])
  byNorm.get(k).push(o)
}

const FILLABLE = ['lat', 'lng', 'address', 'neighborhood', 'instagram_handle']
const proposals = []
const unmatched = []

for (const club of clubs) {
  const nc = norm(club.name)
  let candidates = byNorm.get(nc) || []

  // Fuzzy fallback: substring either direction (avoid tiny tokens)
  if (candidates.length === 0 && nc.length > 4) {
    candidates = osm.filter(o => {
      const no = norm(o.name)
      return no.length > 4 && (no.includes(nc) || nc.includes(no))
    })
  }

  if (candidates.length === 0) {
    unmatched.push({ id: club.id, name: club.name })
    continue
  }

  // Pick best candidate: nearest if we already have coords, else most-complete
  const hasCoords = club.lat != null && club.lng != null
  let best = candidates[0]
  let bestDist = null
  if (hasCoords) {
    for (const c of candidates) {
      const d = haversine(Number(club.lat), Number(club.lng), c.lat, c.lng)
      if (bestDist === null || d < bestDist) { bestDist = d; best = c }
    }
  } else {
    best = candidates.slice().sort((a, b) =>
      FILLABLE.filter(f => b[f]).length - FILLABLE.filter(f => a[f]).length)[0]
  }

  // Only propose fills for fields currently missing on the club
  const fills = {}
  for (const f of FILLABLE) {
    const cur = club[f]
    const isMissing = cur == null || cur === ''
    if (isMissing && best[f] != null && best[f] !== '') fills[f] = best[f]
  }

  if (Object.keys(fills).length === 0) continue // nothing to fill

  const exact = norm(best.name) === nc
  let confidence = 'low'
  if (exact && (bestDist == null || bestDist < 300)) confidence = 'high'
  else if (exact || (bestDist != null && bestDist < 800)) confidence = 'medium'
  if (bestDist != null && bestDist > 1500) confidence = 'low'

  proposals.push({
    club_id: club.id,
    club_name: club.name,
    osm_name: best.name,
    osm_id: best.id,
    distance_m: bestDist,
    confidence,
    fills,
  })
}

proposals.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.confidence] - { high: 0, medium: 1, low: 2 }[b.confidence]))

const report = {
  generated_at: new Date().toISOString(),
  source: 'OpenStreetMap via Overpass (© OpenStreetMap contributors, ODbL)',
  totals: {
    clubs: clubs.length,
    osm_venues: osm.length,
    proposals: proposals.length,
    by_confidence: {
      high: proposals.filter(p => p.confidence === 'high').length,
      medium: proposals.filter(p => p.confidence === 'medium').length,
      low: proposals.filter(p => p.confidence === 'low').length,
    },
    unmatched: unmatched.length,
  },
  proposals,
  unmatched,
}

writeFileSync(new URL('./osm-fill-report.json', import.meta.url), JSON.stringify(report, null, 2))

console.log('\n── Summary ────────────────────────────────')
console.log(`  Proposals: ${proposals.length}  (high ${report.totals.by_confidence.high} · medium ${report.totals.by_confidence.medium} · low ${report.totals.by_confidence.low})`)
console.log(`  Unmatched clubs: ${unmatched.length}`)
console.log('  Wrote scripts/osm-fill-report.json — review before applying.')
console.log('────────────────────────────────────────────')
