// ─────────────────────────────────────────────────────────────────────────────
// set-door-prices.mjs — what you pay at the door, per venue.
//
//   node --env-file=.env.local scripts/set-door-prices.mjs           # dry run
//   node --env-file=.env.local scripts/set-door-prices.mjs --apply
//
// Idempotent: matched on club_id, re-running overwrites in place. Add a venue
// by adding a line to PRICES.
//
// Needs supabase/migrations/20260917_door_price.sql applied. Until it is, this
// writes the FLOOR into the existing general_entry_price column and says so —
// a venue's cheapest door price is still worth having, and nothing is lost when
// the real columns arrive (the trigger keeps that column in step afterwards).
//
// Prices are operator-reported, not scraped. `_asOf` is when we were told, so a
// stale one can be spotted rather than trusted forever.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

// min/max: the weekday door. weekendMin/weekendMax: Fri+Sat, null = same all
// week. max null = a flat price rather than a range.
const PRICES = [
  {
    club_id: '60d6f94e-26cc-4d24-bacc-8a255e1c7924', _club: 'Downtown Barcelona',
    min: 15, max: 20, weekendMin: 22, weekendMax: 25, _asOf: '2026-09-17',
  },
  {
    club_id: 'e0cf6310-28e5-4117-ad5f-01179f87d8fd', _club: 'Sutton Club Barcelona',
    min: 20, max: null, weekendMin: null, weekendMax: null, _asOf: '2026-09-17',
  },
  {
    club_id: 'b3f7747f-d911-490d-a688-d04add6a1c8b', _club: 'Opium Barcelona',
    min: 20, max: null, weekendMin: null, weekendMax: null, _asOf: '2026-09-17',
  },
  {
    club_id: '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2', _club: 'Bling Bling Barcelona',
    min: 20, max: null, weekendMin: null, weekendMax: null, _asOf: '2026-09-17',
  },
]

/** How a row reads on a card. Mirrors doorPriceLabel() in the app. */
function label(p) {
  const one = (a, b) => (b == null || b === a ? `€${a}` : `€${a}–${b}`)
  if (p.min == null) return '—'
  if (p.min === 0 && p.weekendMin == null) return 'Free'
  const week = one(p.min, p.max)
  if (p.weekendMin == null) return week
  return `${week} · ${one(p.weekendMin, p.weekendMax)} weekends`
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// Has the migration landed? Ask the catalog rather than assuming — production
// schema drifts from this folder (manual SQL-editor applies).
const probe = await sb.from('clubs').select('id, door_price_min').limit(1)
const hasColumns = !probe.error
console.log(hasColumns
  ? 'door_price_* columns: present'
  : `door_price_* columns: NOT APPLIED (${probe.error.message.slice(0, 60)})\n` +
    '  → writing the floor into general_entry_price only.\n' +
    '  → run supabase/migrations/20260917_door_price.sql, then re-run this.')

console.log('')
for (const p of PRICES) {
  console.log(`  ${p._club.padEnd(26)} ${label(p).padEnd(26)} (as of ${p._asOf})`)
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  process.exit(0)
}

console.log('')
let ok = 0
for (const p of PRICES) {
  const patch = hasColumns
    ? {
        door_price_min: p.min, door_price_max: p.max,
        door_price_weekend_min: p.weekendMin, door_price_weekend_max: p.weekendMax,
      }
    : { general_entry_price: p.min }
  const { error } = await sb.from('clubs').update(patch).eq('id', p.club_id)
  if (error) { console.error(`  ! ${p._club}: ${error.message}`); continue }
  console.log(`  ✓ ${p._club}`)
  ok++
}
console.log(`\ndone — ${ok}/${PRICES.length} updated`)
