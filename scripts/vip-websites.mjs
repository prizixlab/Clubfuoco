// ─────────────────────────────────────────────────────────────────────────────
// vip-websites.mjs — STAGE 1 of the VIP-table sourcing pipeline. DRY RUN.
//
// The `clubs` table has google_place_id for 1728 rows but no website: the
// Places sync only ever asked for photos/rating/reviews. VIP tables are sold on
// the club's own site (a zone map + an application form), so the website is the
// entry point to every VIP inventory we want. This fetches it.
//
// It also pulls `types`, because `clubs` is not a nightclub list — it is a POI
// dump that includes tapas bars, a hospital and a football stadium. Google's
// `night_club` type is the cheapest honest filter we have, and it arrives in
// the same billed call as the website.
//
// Touches NOTHING in the DB. Writes scripts/vip-websites-report.json.
//
// Run:  node --env-file=.env.local scripts/vip-websites.mjs
//       node --env-file=.env.local scripts/vip-websites.mjs --limit=50
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PLACES_KEY   = process.env.GOOGLE_PLACES_API_KEY
if (!SUPABASE_URL || !SUPABASE_KEY || !PLACES_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}

const REPORT = new URL('./vip-websites-report.json', import.meta.url).pathname
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

// Each Place Details call here bills Basic + Contact data. Resuming from the
// report means a re-run after a crash costs nothing for rows already fetched.
const cache = existsSync(REPORT)
  ? new Map(JSON.parse(readFileSync(REPORT, 'utf8')).rows.map(r => [r.place_id, r]))
  : new Map()

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const { data: clubs, error } = await sb
  .from('clubs')
  .select('id,name,slug,google_place_id,rating,ratings_total,neighborhood,lat,lng,vip_table_min_spend')
  .not('google_place_id', 'is', null)
  .order('ratings_total', { ascending: false, nullsFirst: false })
if (error) { console.error(error); process.exit(1) }

const FIELDS = 'name,website,url,types,formatted_phone_number,business_status'

async function details(placeId) {
  const u = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${FIELDS}&key=${PLACES_KEY}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(u)
    const j = await res.json().catch(() => ({ status: 'PARSE_ERROR' }))
    // OVER_QUERY_LIMIT is the only status worth waiting out; NOT_FOUND and
    // INVALID_REQUEST will not change on a retry.
    if (j.status === 'OVER_QUERY_LIMIT') { await sleep(2000 * (attempt + 1)); continue }
    return j
  }
  return { status: 'OVER_QUERY_LIMIT' }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const rows = []
let fetched = 0, cached = 0, failed = 0

for (const c of clubs.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  const hit = cache.get(c.google_place_id)
  if (hit) { rows.push(hit); cached++; continue }

  const j = await details(c.google_place_id)
  if (j.status !== 'OK') {
    failed++
    rows.push({ place_id: c.google_place_id, club_id: c.id, name: c.name, error: j.status })
  } else {
    fetched++
    const r = j.result
    rows.push({
      place_id:        c.google_place_id,
      club_id:         c.id,
      name:            c.name,
      slug:            c.slug,
      neighborhood:    c.neighborhood,
      rating:          c.rating,
      ratings_total:   c.ratings_total,
      vip_min_spend:   c.vip_table_min_spend,
      website:         r.website ?? null,
      phone:           r.formatted_phone_number ?? null,
      types:           r.types ?? [],
      business_status: r.business_status ?? null,
      host:            r.website ? safeHost(r.website) : null,
    })
  }
  await sleep(60)          // ~16 rps, well under the QPS ceiling
  if ((fetched + failed) % 100 === 0) {
    console.log(`  …${fetched} fetched, ${cached} cached, ${failed} failed`)
    flush()
  }
}

function safeHost(url) {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return null }
}

function flush() {
  const nightlife = rows.filter(r =>
    r.types?.some(t => t === 'night_club' || t === 'bar'))
  const withSite = nightlife.filter(r => r.website)

  // Which platform is the website actually on? This is the whole point of the
  // stage: if the long tail rents its booking from a handful of vendors, the
  // automation target is those vendors, not 1700 bespoke sites.
  const hostCounts = {}
  for (const r of withSite) hostCounts[r.host] = (hostCounts[r.host] || 0) + 1

  writeFileSync(REPORT, JSON.stringify({
    generated_at: new Date().toISOString(),
    totals: {
      considered:    rows.length,
      nightlife:     nightlife.length,
      with_website:  withSite.length,
      no_website:    nightlife.length - withSite.length,
      failed,
    },
    hosts: Object.entries(hostCounts).sort((a, b) => b[1] - a[1]),
    rows,
  }, null, 2))
}

flush()
console.log(`\ndone — ${fetched} fetched, ${cached} cached, ${failed} failed`)
console.log(`report: ${REPORT}`)
