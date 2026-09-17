// ─────────────────────────────────────────────────────────────────────────────
// import-hypelist.mjs — HypeList's brand and their per-venue guestlist offers.
//
//   node --env-file=.env.local scripts/import-hypelist.mjs           # dry run
//   node --env-file=.env.local scripts/import-hypelist.mjs --apply
//
// Idempotent: brand matched on `key`, each offer on (brand_id, club_id, kind).
//
// ── WHERE THIS DATA COMES FROM ───────────────────────────────────────────────
// HypeList sell through Fourvenues, the same platform BesoList use. Their
// marketing site (hypelistbarcelona.com) lists nine venues and no calendar, and
// its "Choose Your Night" picker is decorative — all seven day tabs render the
// identical four cards. Their venue pages link out to
//   site.fourvenues.com/en/hypelist-barcelona@<venue>
// and the promoter-wide embed at /en/iframe/hypelist-barcelona/events serves
// their real calendar with no Cloudflare challenge.
//
// Harvested 17 Sep 2026: 170 events, 17 Sep – 3 Oct, across 24 venues — not the
// nine the website advertises. The slug is genuinely scoped: a nonsense slug on
// the same route renders zero events.
//
// NIGHTS ARE COUNTED, NOT COPIED. An event starting before 06:00 is filed under
// the PREVIOUS night, which is how a club night works and how the source files
// it — without that shift every late room reads a day late (Bling Bling's 00:30
// Thursday party would say Friday). A night counts as a residency only if it
// recurs; a single sighting in two and a half weeks is a one-off, and promising
// it would send someone to a shut room. Dropped one-offs are listed per row.
//
// Times, minimum ages and genres are HypeList's own, from the same cards.
// `_window` is the most common start→end PAIR, not the two modes taken
// separately — NIX runs a 18:00 tardeo and a 00:00 club night, and mixing the
// modes would have invented "00:00 – 22:30".
//
// NOT IMPORTED, and why — every one is a refusal to guess:
//   Nu Bcn, ETNIA, Brisa Open Air   no row in `clubs` at all
//   DISCOTECA MON MADRID            Madrid. This is a Barcelona app.
//   ATLANTIC CLUB                   only "Atlantic Sound BCN" is close, and
//                                   those are not obviously the same room; also
//                                   no residency (one Wed, one Sat)
//   Duvet, 4 Latas Club             in `clubs`, but one-offs only — no residency
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

const BRAND = {
  key:   'hypelist',
  name:  'HypeList',
  // Their own accent, sampled from the site's WhatsApp button. Tints the
  // promoter's credit only — never the app accent, which stays gold.
  color: '#814AC8',
  login_email: 'hypelist@clubfuoco.com',
}

/** "18+", or "18+, higher on some nights" when the door varies by party. */
const ageNote = (ages) => {
  if (!ages.length) return null
  const min = Math.min(...ages)
  return ages.length === 1 ? `${min}+` : `${min}+, higher on some nights`
}

const title = (s) => s.replace(/\b\w/g, c => c.toUpperCase())

// club_id verified against `clubs` on 17 Sep 2026.
const OFFERS = [
  { club_id: 'b3f7747f-d911-490d-a688-d04add6a1c8b', _club: 'Opium Barcelona',
    nights: 'Every night', _window: '23:30 – 05:00', ages: [18], _n: 16,
    genres: ['hits', 'reggaeton', 'edm', 'house'] },
  { club_id: 'd184f2f1-8db3-4d03-ae11-ad19b650894d', _club: 'Ku (formerly Pacha)',
    nights: 'Every night', _window: '23:45 – 05:00', ages: [18], _n: 23,
    genres: ['reggaeton', 'r&b', 'afrobeat', 'hits'] },
  { club_id: '2706f18a-76ce-4276-abc0-ba53b7d6894d', _club: 'Bastian Beach',
    nights: 'Every night', _window: '11:00 – 19:00', ages: [18], _n: 16, genres: [],
    _note: 'daytime pool club, not a night out', _clubInactive: true },
  { club_id: '60d6f94e-26cc-4d24-bacc-8a255e1c7924', _club: 'Downtown Barcelona',
    nights: 'Wed, Thu, Fri, Sat', _window: '23:59 – 05:00', ages: [18], _n: 10,
    genres: ['reggaeton', 'hits', 'comercial', 'old-school'] },
  { club_id: '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2', _club: 'Bling Bling Barcelona',
    nights: 'Wed, Thu, Fri, Sat', _window: '00:30 – 05:00', ages: [18, 21, 25], _n: 10,
    genres: ['hits', 'reggaeton', 'comercial'] },
  { club_id: 'e0cf6310-28e5-4117-ad5f-01179f87d8fd', _club: 'Sutton Club Barcelona',
    nights: 'Thu, Fri, Sat', _window: '00:00 – 05:00', ages: [18, 20, 23], _n: 10,
    genres: ['reggaeton', 'hits', 'pop'], _dropped: 'Wed' },
  { club_id: '4ad56773-ffc0-4122-9dff-58bb77fb934d', _club: 'El Tardet',
    nights: 'Thu, Fri, Sat', _window: '19:00 – 00:00', ages: [23], _n: 14, genres: [],
    _note: 'seafront tardeo, early evening' },
  { club_id: 'b9bc5258-4349-4f05-af59-6556d961524a', _club: 'Otto Zutz Club',
    nights: 'Thu, Fri, Sat', _window: '00:00 – 06:00', ages: [18], _n: 8,
    genres: ['reggaeton', 'hits', 'underground', 'hip-hop'], _dropped: 'Wed' },
  { club_id: '1a49859c-ebcf-417a-b025-3dd84bcb1d54', _club: 'La Biblio',
    nights: 'Thu, Fri, Sat', _window: '00:00 – 06:00', ages: [18, 21, 22, 23], _n: 7,
    genres: ['reggaeton'], _dropped: 'Wed' },
  { club_id: '277cd0b1-c8c5-4769-bf28-07d03f96d145', _club: 'Boris Club',
    nights: 'Thu, Fri, Sat', _window: '00:30 – 06:00', ages: [18, 20, 21], _n: 9,
    genres: ['house'], _dropped: 'Wed' },
  { club_id: '00e3f149-bd90-4180-83f9-a79ebf71ab8f', _club: 'HYPE Barcelona',
    nights: 'Thu, Fri', _window: '00:00 – 05:00', ages: [17, 18], _n: 6,
    genres: ['reggaeton', 'hits'], _dropped: 'Wed', _note: 'their own room' },
  { club_id: '3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb', _club: 'Twenties Barcelona',
    nights: 'Fri, Sat', _window: '00:00 – 06:00', ages: [18], _n: 5,
    genres: ['reggaeton', 'hits', 'house', 'comercial'] },
  { club_id: 'f710a3a3-c84e-408a-a061-d6791215848a', _club: 'La Fira Casanova',
    nights: 'Fri, Sat', _window: '23:45 – 05:30', ages: [18], _n: 4,
    genres: ['reggaeton', 'hits', 'dance', 'comercial'] },
  { club_id: '5eaaf6ad-c479-4e7e-b735-f3459b319aac', _club: 'La Fira Villarroel',
    nights: 'Sat', _window: '00:00 – 05:30', ages: [18], _n: 3,
    genres: ['reggaeton', 'pop', 'disco', 'comercial'], _dropped: 'Fri' },
  { club_id: 'fb8a09e0-6a79-4023-b990-6a0702d88053', _club: 'La Fira Provença',
    nights: 'Sat', _window: '18:00 – 03:30', ages: [40], _n: 2, genres: ['disco'],
    _note: 'over-40s tardeo' },
  { club_id: 'dbf8342b-e7b8-4f27-97d2-5982bc4a3947', _club: 'Costa Breve',
    nights: 'Sat', _window: '00:30 – 06:00', ages: [18, 21], _n: 3, genres: [],
    _dropped: 'Thu' },
  { club_id: '91ef759c-4b34-4e63-ab2a-ac015dcf76e8', _club: 'NIX BARCELONA',
    nights: 'Sat', _window: '18:00 – 22:30', ages: [18], _n: 4, genres: [],
    _dropped: 'Fri', _note: 'the recurring Saturday here is a tardeo' },
]

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// Every club_id is re-checked against the live table before anything is
// written. A placeholder or a stale id must fail loudly here rather than create
// an offer nobody can ever see.
const ids = OFFERS.map(o => o.club_id)
const { data: clubRows } = await sb.from('clubs').select('id, name, is_active').in('id', ids)
const found = new Map((clubRows ?? []).map(c => [c.id, c]))
const missing = OFFERS.filter(o => !found.has(o.club_id))
if (missing.length) {
  console.error('! club_id not found for:')
  for (const m of missing) console.error(`    ${m._club}  ${m.club_id}`)
  console.error('  Fix the ids above before running with --apply.')
  if (APPLY) process.exit(1)
}

let brand = (await sb.from('partner_brands').select('*').eq('key', BRAND.key).maybeSingle()).data
if (!brand) {
  console.log(`brand "${BRAND.name}" — NOT PRESENT, would create`)
  if (APPLY) {
    const { data, error } = await sb.from('partner_brands')
      .insert({ ...BRAND, is_active: false, offers_hidden: true })
      .select('*').single()
    if (error) { console.error('! could not create brand:', error.message); process.exit(1) }
    brand = data
    console.log(`  + created ${brand.id}`)
  }
} else {
  console.log(`brand "${brand.name}" — present ${brand.id}${brand.offers_hidden ? '  (offers_hidden ON)' : ''}`)
}
if (!brand) { console.log('\nDRY RUN — no brand yet.'); process.exit(0) }

const existing = (await sb.from('partner_offers').select('*').eq('brand_id', brand.id)).data ?? []
const byKey = new Map(existing.map(o => [`${o.club_id}|${o.kind}`, o]))

const rowFor = (o, i) => ({
  brand_id:    brand.id,
  club_id:     o.club_id,
  kind:        'free_guestlist',
  title:       'Free Guestlist',
  subtitle:    ['Free guestlist', o._note, ageNote(o.ages)].filter(Boolean).join(' · '),
  price_eur:   null,
  party_size:  null,
  time_window: o._window,
  valid_days:  o.nights,
  dress_code:  'Smart casual — no sportswear',
  music:       o.genres.length ? o.genres.map(title).join(' · ') : 'Mixed',
  sort_order:  i,
  is_active:   true,
  capacity:    null,
})

console.log(`\n${OFFERS.length} offers — nights counted from HypeList's own calendar\n`)
for (const o of OFFERS) {
  const c = found.get(o.club_id)
  const hit = byKey.get(`${o.club_id}|free_guestlist`)
  console.log(`  ${hit ? '~' : '+'} ${o._club.padEnd(24)} ${o.nights.padEnd(20)} ${o._window.padEnd(15)} ${String(o._n).padStart(2)} ev  ${ageNote(o.ages) ?? ''}`)
  if (o._dropped) console.log(`      dropped one-off: ${o._dropped}`)
  if (c && !c.is_active) console.log(`      ! venue is INACTIVE in clubs — the offer will not surface until it is switched on`)
}

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0) }

let created = 0, updated = 0
for (const [i, o] of OFFERS.entries()) {
  const row = rowFor(o, i)
  const hit = byKey.get(`${o.club_id}|free_guestlist`)
  if (hit) {
    const { error } = await sb.from('partner_offers').update(row).eq('id', hit.id)
    if (error) { console.error(`  ! ${o._club}: ${error.message}`); continue }
    updated++
  } else {
    const { error } = await sb.from('partner_offers').insert(row)
    if (error) { console.error(`  ! ${o._club}: ${error.message}`); continue }
    created++
  }
}
console.log(`\ndone — ${created} created, ${updated} updated`)
