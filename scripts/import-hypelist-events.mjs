// ─────────────────────────────────────────────────────────────────────────────
// import-hypelist-events.mjs — HypeList's calendar into `promoter_nights`.
//
//   node --env-file=.env.local scripts/import-hypelist-events.mjs          # dry run
//   node --env-file=.env.local scripts/import-hypelist-events.mjs --apply
//
// Reads data/suppliers/hypelist/events.tsv — 365 events, 17 Sep – 31 Dec 2026,
// harvested from HypeList's Fourvenues embed on 17 Sep 2026. See the README in
// that folder for how it was collected and why.
//
// Run scripts/import-hypelist.mjs and scripts/provision-hypelist-account.mjs
// first: this needs both the brand and the owning account to exist.
//
// ── THE TWO DATE CORRECTIONS, both of which change which day an event lands on
//
// 1. NIGHT, NOT CALENDAR DAY. An event starting before 06:00 belongs to the
//    PREVIOUS night — a 00:30 Saturday card is Friday night out. open_time and
//    close_time keep the real clock, so nothing is lost.
//
// 2. THE SOURCE'S MONTH LAGS AT A ROLLOVER. Some cards carry the right day and
//    weekday but the previous month: "Bling Bling, 1 Thursday September" is
//    1 October, and Sutton's "New Year's Eve 2027" arrives as 1 December.
//    Left alone these land months in the past, where nobody sees them.
//
//    The weekday is the check. 1 September 2026 is a Tuesday, so a card saying
//    "1 Thursday September" cannot be September. Walk forward — next month, the
//    month after, then the same date next year — and take the first candidate
//    whose weekday matches what the card says. A row that matches nothing is
//    skipped rather than guessed at.
//
// Other decisions:
//
//   * created_by is HypeList's own account, resolved from the brand's
//     owner_user_id rather than hardcoded.
//   * review_status is forced to 'approved' AFTER insert. A before-insert
//     trigger parks every new night at 'pending'; these are an operator load,
//     not a promoter submission, so they should not sit in the Changes queue.
//   * price_cents 0 / is_published true. The source exposes no prices, and
//     a priced night is refused for an account with no payout row anyway.
//   * Only venues that map to a `clubs` row are imported. The rest are
//     reported, never guessed — see the README for who and why.
//   * Idempotent on (club_id, night_date, title).
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

const YEAR = 2026

// HypeList's venue string → clubs.id. Verified by name on 17 Sep 2026.
const VENUE = {
  'Opium Barcelona':      'b3f7747f-d911-490d-a688-d04add6a1c8b',
  'Ku Barcelona':         'd184f2f1-8db3-4d03-ae11-ad19b650894d',
  'Bling Bling BCN':      '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2',
  'SUTTON BARCELONA':     'e0cf6310-28e5-4117-ad5f-01179f87d8fd',
  'DOWNTOWN BARCELONA':   '60d6f94e-26cc-4d24-bacc-8a255e1c7924',
  'BASTIAN BEACH':        '2706f18a-76ce-4276-abc0-ba53b7d6894d',
  'OTTO ZUTZ':            'b9bc5258-4349-4f05-af59-6556d961524a',
  'El Tardet Barcelona':  '4ad56773-ffc0-4122-9dff-58bb77fb934d',
  'Twenties Barcelona':   '3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb',
  'Boris':                '277cd0b1-c8c5-4769-bf28-07d03f96d145',
  'La Biblio BCN':        '1a49859c-ebcf-417a-b025-3dd84bcb1d54',
  'HYPE BARCELONA':       '00e3f149-bd90-4180-83f9-a79ebf71ab8f',
  'NIX BARCELONA':        '91ef759c-4b34-4e63-ab2a-ac015dcf76e8',
  'La Fira Casanova':     'f710a3a3-c84e-408a-a061-d6791215848a',
  'La Fira Villarroel':   '5eaaf6ad-c479-4e7e-b735-f3459b319aac',
  'La Fira Provença':     'fb8a09e0-6a79-4023-b990-6a0702d88053',
  'COSTA BREVE':          'dbf8342b-e7b8-4f27-97d2-5982bc4a3947',
}

// Advertised by HypeList but deliberately not imported.
const SKIP = {
  'DISCOTECA MON MADRID': 'Madrid — this is a Barcelona app',
  'Nu Bcn':               'no clubs row',
  'ETNIA':                'no clubs row',
  'Brisa Open Air':       'no clubs row',
  'ATLANTIC CLUB':        'only "Atlantic Sound BCN" is close — not clearly the same room',
  'Duvet':                'in clubs, but a single one-off',
  '4 Latas Club':         'in clubs, but one-offs only',
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const iso = (d) => d.toISOString().slice(0, 10)

/**
 * The real date behind a card, using its weekday as the check.
 *
 * Returns null when nothing within a year matches — a row we cannot place is
 * dropped, not moved to a date we invented.
 */
function resolveDate(month, day, dowLabel) {
  const cands = [
    [YEAR, month], [YEAR, month + 1], [YEAR, month + 2], [YEAR + 1, month],
  ]
  for (const [y, m] of cands) {
    const d = new Date(Date.UTC(y, m - 1, day))
    // Reject a rolled-over day (e.g. 31 Feb becoming 3 March).
    if (d.getUTCMonth() !== (m - 1 + 12) % 12) continue
    if (DOW[d.getUTCDay()] === dowLabel) return d
  }
  return null
}

const lines = readFileSync('data/suppliers/hypelist/events.tsv', 'utf8')
  .split('\n').filter(l => l.trim())

const rows = []
const skipped = {}
const unplaceable = []
const corrected = []

for (const line of lines) {
  const [venue, monthS, dayS, dow, start, end, , genres, title] = line.split('\t')
  if (SKIP[venue]) { (skipped[venue] ??= []).push(title); continue }
  const club_id = VENUE[venue]
  if (!club_id) { (skipped[`UNMAPPED: ${venue}`] ??= []).push(title); continue }

  const month = Number(monthS), day = Number(dayS)
  const startDate = resolveDate(month, day, dow)
  if (!startDate) { unplaceable.push(`${venue} ${month}/${day} ${dow} ${title}`); continue }
  if (startDate.getUTCMonth() + 1 !== month) {
    corrected.push(`${venue}: ${month}/${day} ${dow} → ${iso(startDate)}  ${title}`)
  }

  // The night an event belongs to: before 06:00 is the previous evening.
  const night = new Date(startDate)
  if (Number(start.slice(0, 2)) < 6) night.setUTCDate(night.getUTCDate() - 1)

  rows.push({
    club_id,
    title,
    night_date: iso(night),
    open_time: start,
    close_time: end,
    // Their own genre tags become the night's lineup-free description; the
    // lineup column is for billed DJs, which this source does not give.
    description: genres ? `Music: ${genres}` : null,
    created_by: null,          // filled once the owner is resolved
    is_published: true,
    visibility: 'public',
    price_cents: 0,
    currency: 'eur',
    is_house: false,
    featured: false,
  })
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
const { data: brand } = await sb.from('partner_brands').select('*').eq('key', 'hypelist').maybeSingle()
if (!brand) { console.error('! no brand "hypelist" — run import-hypelist.mjs --apply first'); process.exit(1) }
if (!brand.owner_user_id) { console.error('! brand has no owner — run provision-hypelist-account.mjs --apply'); process.exit(1) }
const OWNER = brand.owner_user_id
for (const r of rows) r.created_by = OWNER
console.log(`brand  ${brand.name} ${brand.id}\nowner  ${OWNER}`)

const today = iso(new Date())
const past = rows.filter(r => r.night_date < today)
const byVenue = {}
for (const r of rows) byVenue[r.club_id] = (byVenue[r.club_id] || 0) + 1
const nameOf = {}
for (const [n, id] of Object.entries(VENUE)) if (!nameOf[id]) nameOf[id] = n

console.log(`\n${rows.length} of ${lines.length} events map to ${Object.keys(byVenue).length} venues`)
for (const [id, n] of Object.entries(byVenue).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}  ${nameOf[id]}`)
}
const dates = rows.map(r => r.night_date).sort()
console.log(`\nnight range: ${dates[0]} → ${dates[dates.length - 1]}`)
if (past.length) console.log(`  ${past.length} land in the past and are skipped on write`)

if (corrected.length) {
  console.log(`\n${corrected.length} date(s) corrected from a lagging source month:`)
  for (const c of corrected) console.log(`   ${c}`)
}
if (unplaceable.length) {
  console.log(`\n${unplaceable.length} row(s) whose weekday matches no candidate date — DROPPED:`)
  for (const u of unplaceable) console.log(`   ${u}`)
}
console.log('\nnot imported:')
for (const [why, titles] of Object.entries(skipped)) {
  console.log(`   ${String(titles.length).padStart(3)}  ${why}${SKIP[why] ? ` — ${SKIP[why]}` : ''}`)
}

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0) }

const writable = rows.filter(r => r.night_date >= today)
const { data: existing } = await sb.from('promoter_nights')
  .select('id, club_id, night_date, title').eq('created_by', OWNER)
const seen = new Map((existing ?? []).map(r => [`${r.club_id}|${r.night_date}|${r.title}`, r.id]))

let created = 0, updated = 0, failed = 0
const newIds = []
for (const row of writable) {
  const key = `${row.club_id}|${row.night_date}|${row.title}`
  const hit = seen.get(key)
  if (hit) {
    const { error } = await sb.from('promoter_nights')
      .update({ open_time: row.open_time, close_time: row.close_time, is_published: true })
      .eq('id', hit)
    if (error) { console.error(`  ! ${row.night_date} ${row.title}: ${error.message}`); failed++; continue }
    updated++
  } else {
    const { data, error } = await sb.from('promoter_nights').insert(row).select('id').single()
    if (error) { console.error(`  ! ${row.night_date} ${row.title}: ${error.message}`); failed++; continue }
    newIds.push(data.id); created++
  }
}

// The before-insert trigger parks every new night at 'pending'. An operator
// load is not a promoter submission, so lift these out of the Changes queue.
let approved = 0
for (let i = 0; i < newIds.length; i += 100) {
  const batch = newIds.slice(i, i + 100)
  const { error } = await sb.from('promoter_nights')
    .update({ review_status: 'approved' }).in('id', batch)
  if (error) console.error('  ! approve batch:', error.message)
  else approved += batch.length
}

console.log(`\ndone — ${created} created, ${updated} updated, ${failed} failed`)
console.log(`review_status forced to approved on ${approved} new rows`)
