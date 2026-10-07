// ─────────────────────────────────────────────────────────────────────────────
// add-besolist-venues.mjs — add the BesoList rooms missing from `clubs`.
//
// BesoList (site.fourvenues.com/en/besolist) sells 382 events across Sep–Nov
// 2026 in 18 rooms. Fifteen already exist in `clubs`. These five do not, and
// between them they carry 47 of those events — so a promoter we care about is
// selling nights at venues the app cannot render.
//
// Enriches each from Google Places (the same fields the rest of the table was
// built from), then inserts. Idempotent on google_place_id.
//
// Dry run by default — prints what it would write and touches nothing:
//   node --env-file=.env.local scripts/add-besolist-venues.mjs
// Write for real:
//   node --env-file=.env.local scripts/add-besolist-venues.mjs --apply
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PLACES_KEY   = process.env.GOOGLE_PLACES_API_KEY
if (!SUPABASE_URL || !SUPABASE_KEY || !PLACES_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

// place_id resolved via Places Find Place, checked by hand against the address
// BesoList lists. Event counts are BesoList's Sep–Nov 2026 calendar.
const VENUES = [
  { place_id: 'ChIJh2u914CjpBIRzVCPfxyHGzM', name: 'El Tardet',                 events: 31 },
  { place_id: 'ChIJQ-GoQwCjpBIRFhV7lKYHOOQ', name: 'HYPE Barcelona',            events: 6  },
  { place_id: 'ChIJgSCL4UejpBIRgwaXpvnEZ30', name: 'La Fira Casanova',          events: 5  },
  { place_id: 'ChIJi18F3JyipBIRig68MpDAcCU', name: 'La Fira Villarroel',        events: 3  },
  { place_id: 'ChIJcdhsH5SipBIROvB9YooBoXc', name: 'Duvet Barcelona',           events: 2  },
]

const FIELDS = [
  'place_id','name','formatted_address','geometry','types','business_status',
  'rating','user_ratings_total','website','formatted_phone_number','opening_hours','photos',
].join(',')

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** The neighbourhood Google puts in the address, e.g. "Eixample". */
function neighborhood(addr) {
  const parts = (addr || '').split(',').map(s => s.trim())
  // …street, number, NEIGHBOURHOOD, 08036 Barcelona, Spain
  const hit = parts.find(p => /^(Eixample|Gr[àa]cia|Sarri[àa].*|Ciutat Vella|Sants.*|Sant Mart[íi]|Horta.*|Nou Barris|Sant Andreu|Les Corts|Poblenou|Poble Sec|Barceloneta|El Raval|El Born|G[òo]tic)$/i.test(p))
  return hit ?? null
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const rows = []
for (const v of VENUES) {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${v.place_id}&fields=${FIELDS}&key=${PLACES_KEY}`)
  const j = await res.json()
  if (j.status !== 'OK') { console.error(`  ! ${v.name}: ${j.status}`); continue }
  const r = j.result
  const loc = r.geometry?.location ?? {}

  rows.push({
    name:             v.name,
    slug:             slugify(v.name),
    address:          r.formatted_address ?? null,
    neighborhood:     neighborhood(r.formatted_address),
    lat:              loc.lat ?? null,
    lng:              loc.lng ?? null,
    google_place_id:  r.place_id,
    rating:           r.rating ?? null,
    ratings_total:    r.user_ratings_total ?? null,
    opening_hours:    r.opening_hours?.weekday_text ?? null,
    // Google photo references, matching how backfill-venue-photos.py stores them.
    photos:           (r.photos ?? []).slice(0, 10).map(p => p.photo_reference),
    is_active:        true,
    is_featured:      false,
    places_synced_at: new Date().toISOString(),
  })

  console.log(`  ${v.name.padEnd(22)} ${String(r.rating ?? '–').padStart(4)} ★  ${String(r.user_ratings_total ?? 0).padStart(6)} reviews  ${(r.types ?? []).includes('night_club') ? 'night_club' : (r.types ?? [])[0] ?? ''}`)
  console.log(`  ${''.padEnd(22)} ${r.formatted_address}`)
}

if (!APPLY) {
  console.log(`\nDRY RUN — would insert ${rows.length} rows into \`clubs\`. Re-run with --apply.`)
  process.exit(0)
}

// Insert one at a time so a single bad row cannot take the batch down, and so
// the log says exactly which venue landed.
let added = 0, skipped = 0
for (const row of rows) {
  const { data: existing } = await sb.from('clubs')
    .select('id,name').eq('google_place_id', row.google_place_id).maybeSingle()
  if (existing) { console.log(`  = ${row.name} already present as "${existing.name}"`); skipped++; continue }

  const { data, error } = await sb.from('clubs').insert(row).select('id,name').single()
  if (error) { console.error(`  ! ${row.name}: ${error.message}`); continue }
  console.log(`  + ${data.name}  ${data.id}`)
  added++
}
console.log(`\ndone — ${added} added, ${skipped} already present`)
