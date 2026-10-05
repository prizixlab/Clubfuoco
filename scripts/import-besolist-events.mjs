// ─────────────────────────────────────────────────────────────────────────────
// import-besolist-events.mjs — load BesoList's calendar into `promoter_nights`
// as events owned by their promoter account.
//
//   node --env-file=.env.local scripts/import-besolist-events.mjs          # dry run
//   node --env-file=.env.local scripts/import-besolist-events.mjs --apply
//
// Reads data/suppliers/besolist/events.json (383 events, 2026-09-16 ..
// 2026-12-31, harvested from the Fourvenues public embed on 16 Sep 2026).
//
// Run scripts/import-besolist.mjs and scripts/provision-besolist-account.mjs
// first — this needs both the brand and the owning account to exist.
//
// Decisions worth knowing:
//
//   * created_by is BesoList's own account, resolved from the brand's
//     owner_user_id rather than hardcoded, so this cannot silently attribute
//     383 events to whoever happened to be linked when it was written.
//
//   * night_date is the NIGHT the event belongs to, not the calendar date its
//     start time falls on. A 12:30 AM Saturday-night event is filed under
//     Saturday — that is how the source files it and how a guest thinks about
//     it. open_time/close_time carry the real clock times, so no information
//     is lost.
//
//   * review_status is forced to 'approved' AFTER insert. promoter_nights has
//     a before-insert trigger (20260713_promoter_night_review.sql) that holds
//     every new night at 'pending'. These are being loaded by the operator,
//     not submitted by a promoter, so they should not land in the Changes
//     queue — but the trigger is the right default and is left alone.
//
//   * price_cents 0 / is_published true. The source exposes no prices; these
//     are free-entry listings until BesoList sets their own ticketing up.
//     `20260821_price_requires_payouts.sql` would block a priced night for an
//     account with no payout row anyway.
//
//   * FOUR events are deliberately skipped, not guessed (see SKIP below).
//     Two more are mapped on an explicit textual claim, not a fuzzy match.
//
//   * Idempotent on (club_id, night_date, title). Re-running updates times in
//     place instead of duplicating the calendar.
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

// BesoList's venue string → clubs.id. Verified by name AND address, 16 Sep 2026.
const VENUE = {
  'BASTIAN BEACH':        '2706f18a-76ce-4276-abc0-ba53b7d6894d',
  'La Biblio BCN':        '1a49859c-ebcf-417a-b025-3dd84bcb1d54',
  'Opium Barcelona':      'b3f7747f-d911-490d-a688-d04add6a1c8b',
  'Ku Barcelona':         'd184f2f1-8db3-4d03-ae11-ad19b650894d',
  'SUTTON BARCELONA':     'e0cf6310-28e5-4117-ad5f-01179f87d8fd',
  'Bling Bling BCN':      '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2',
  'El Tardet Barcelona':  '4ad56773-ffc0-4122-9dff-58bb77fb934d',
  'DOWNTOWN BARCELONA':   '60d6f94e-26cc-4d24-bacc-8a255e1c7924',
  'HYPE BARCELONA':       '00e3f149-bd90-4180-83f9-a79ebf71ab8f',
  'OTTO ZUTZ':            'b9bc5258-4349-4f05-af59-6556d961524a',
  'Boris':                '277cd0b1-c8c5-4769-bf28-07d03f96d145',
  'Duvet':                'cd260c75-6a5e-464e-a24d-48155b6d0c5a',
  'La Fira Casanova':     'f710a3a3-c84e-408a-a061-d6791215848a',
  'La Fira Villarroel':   '5eaaf6ad-c479-4e7e-b735-f3459b319aac',
  'Twenties Barcelona':   '3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb',
  'La Fira Provença':     'fb8a09e0-6a79-4023-b990-6a0702d88053',
  'COSTA BREVE':          'dbf8342b-e7b8-4f27-97d2-5982bc4a3947',
  '4 Latas Club':         '018e3c22-f309-4555-82da-19e425c927fd',

  // Mapped on what the string itself says, not on similarity:
  //   the venue string NAMES Ku, and the event title says "at Ku Barcelona".
  'PARIPÉ x Ku Barcelona': 'd184f2f1-8db3-4d03-ae11-ad19b650894d',
  'Dennis Quin':           'd184f2f1-8db3-4d03-ae11-ad19b650894d',
}

// Not imported. Fourvenues puts a DJ's name in the venue field for some SIGHT
// bookings; "Marcel BS" fuzzy-matches "Bodega Marcel Cava-vino", which is
// exactly the kind of confident nonsense worth refusing. Brisa Open Air and
// Nu Bcn are real rooms with no `clubs` row — add them before importing these.
const SKIP = {
  'Marcel BS':         'DJ name in the venue field; room not stated',
  'Gustavo Dominguez': 'DJ name in the venue field; room not stated',
  'Brisa Open Air':    'no clubs row',
  'Nu Bcn':            'no clubs row',
}

/** "11:45 PM" → "23:45", "12:30 AM" → "00:30". */
function to24(t) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((t || '').trim())
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

const src = JSON.parse(readFileSync('data/suppliers/besolist/events.json', 'utf8'))
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Resolve the brand and its owner ──────────────────────────────────────────
const { data: brand } = await sb.from('partner_brands').select('*').eq('key', 'besolist').maybeSingle()
if (!brand) {
  console.error('! no brand with key "besolist" — run scripts/import-besolist.mjs --apply first')
  process.exit(1)
}
if (!brand.owner_user_id) {
  console.error('! brand has no owner_user_id — run scripts/provision-besolist-account.mjs --apply first')
  process.exit(1)
}
const OWNER = brand.owner_user_id
console.log(`brand  ${brand.name} ${brand.id}`)
console.log(`owner  ${OWNER}`)

// ── Build rows ───────────────────────────────────────────────────────────────
const rows = []
const skipped = {}
for (const [night_date, start, end, title, venue] of src.events) {
  if (SKIP[venue]) { (skipped[venue] ??= []).push(title); continue }
  const club_id = VENUE[venue]
  if (!club_id) { (skipped[`UNMAPPED: ${venue}`] ??= []).push(title); continue }
  rows.push({
    club_id,
    title,
    night_date,
    open_time:  to24(start),
    close_time: to24(end),
    created_by: OWNER,
    is_published: true,
    visibility: 'public',
    price_cents: 0,
    currency: 'eur',
    is_house: false,
    featured: false,
  })
}

const byVenue = {}
for (const r of rows) byVenue[r.club_id] = (byVenue[r.club_id] || 0) + 1
// Several venue strings alias one club (Ku is named three ways), so keep the
// FIRST name for each id — otherwise the summary labels 68 Ku nights
// "Dennis Quin", which reads like a mapping bug that isn't one.
const nameOf = {}
for (const [n, id] of Object.entries(VENUE)) if (!nameOf[id]) nameOf[id] = n

console.log(`\n${rows.length} of ${src.events.length} events map to ${Object.keys(byVenue).length} venues`)
for (const [id, n] of Object.entries(byVenue).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}  ${nameOf[id]}`)
}
console.log('\nskipped:')
for (const [why, titles] of Object.entries(skipped)) {
  console.log(`   ${titles.length}  ${why}${SKIP[why] ? ` — ${SKIP[why]}` : ''}`)
}
const badTime = rows.filter(r => !r.open_time || !r.close_time)
if (badTime.length) console.log(`\n! ${badTime.length} rows have an unparseable time — they would be written with null`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  process.exit(0)
}

// ── Write ────────────────────────────────────────────────────────────────────
// Existing BesoList nights, so a re-run updates rather than duplicates.
const { data: existing } = await sb.from('promoter_nights')
  .select('id, club_id, night_date, title').eq('created_by', OWNER)
const seen = new Map((existing ?? []).map(r => [`${r.club_id}|${r.night_date}|${r.title}`, r.id]))

let created = 0, updated = 0, failed = 0
const newIds = []
for (const row of rows) {
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
    newIds.push(data.id)
    created++
  }
}

// The before-insert trigger parks every new night at 'pending'. These are an
// operator load, not a promoter submission, so lift them out of the queue.
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
