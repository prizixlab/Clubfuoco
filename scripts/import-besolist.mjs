// ─────────────────────────────────────────────────────────────────────────────
// import-besolist.mjs — stand up BesoList as a promoter: their brand + their
// per-venue club offers.
//
// BesoList (site.fourvenues.com/en/besolist) currently sells through
// Fourvenues and is moving onto Club Fuoco. Their public calendar was
// harvested on 16 Sep 2026 — 383 events, 2026-09-16 .. 2026-12-31, across 18
// rooms that all already exist in `clubs`. See
// data/suppliers/besolist/calendar-summary.json for the harvest, the venue
// mapping and the caveats.
//
//   node --env-file=.env.local scripts/import-besolist.mjs           # dry run
//   node --env-file=.env.local scripts/import-besolist.mjs --apply   # write
//
// Idempotent: the brand is matched on `key`, each offer on
// (brand_id, club_id, kind). Re-running updates in place rather than
// duplicating, so this is safe to run again after editing the table below.
//
// Decisions worth knowing, because they are judgement calls not mechanics:
//
//   * ONE OFFER PER VENUE, not per event. `partner_offers` is a standing
//     per-venue product keyed by valid_days; the 383 individual nights are
//     events, and they need a BesoList ACCOUNT before they can be written
//     (promoter_nights.created_by is a real auth uid). That step is blocked
//     until we have their login email.
//
//   * NIGHTS ARE THE RESIDENCY, NOT EVERY OBSERVED DATE. A venue's valid_days
//     is the set of nights BesoList actually runs there week after week. One-off
//     outliers are dropped: Bling Bling shows Sun(2)/Mon(1) against
//     Wed(16)/Thu(14)/Fri(14)/Sat(14), and promising a guest Monday at Bling
//     Bling on the strength of a single August date is how a list goes wrong.
//     The dropped outliers are listed in `_outliers` on each row.
//
//   * kind = 'free_guestlist' EVERYWHERE. The calendar exposes no prices at
//     all, and `vip_table` rows are refused without one (portal-schemas.ts).
//     BesoList does sell VIP zones — those are on the per-event pages and are
//     a separate import once we have their table inventory and prices.
//
//   * dress_code IS NOT SOURCED FROM BESOLIST. They publish none. Every row
//     carries the app's own house default, marked `_dressCodeIsDefault`.
//     Same for `music: 'Mixed'` where BesoList lists no genres — inventing a
//     genre for a room we have not heard is worse than saying nothing.
//
//   * MINIMUM AGE RIDES IN THE SUBTITLE. It varies by venue (Bling Bling 25+,
//     El Tardet and Sutton 23+, Boris and Costa Breve 21+, La Fira Provença
//     40+) and `partner_offers` has no column for it, so it goes where a guest
//     will actually read it before turning up and being refused at the door.
//
//   * The 6 unresolved calendar entries are deliberately NOT imported: Brisa
//     Open Air and Nu Bcn have no `clubs` row, and "Marcel BS" / "Gustavo
//     Dominguez" / "Dennis Quin" are DJ names Fourvenues put in the venue
//     field. "Marcel BS" fuzzy-matched "Bodega Marcel Cava-vino", which is the
//     kind of confident nonsense this file refuses to write.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

// Club Fuoco gold. NEVER pink — that is the retired Rumbalist mark.
// BesoList have not given us their own accent yet; this is the same default
// provisionBrandForUser() uses, and it is a one-field edit in the portal.
const BRAND = {
  key:   'besolist',
  name:  'BesoList',
  color: '#C09950',
  // House convention for a promoter account stood up from here. Storing it
  // does NOT email anyone — the portal's "Send password link & grant access"
  // button is what actually invites them, when we're ready for them to log in.
  login_email: 'besolist@clubfuoco.com',
}

const DRESS_DEFAULT = 'Smart casual — no sportswear'

// club_id verified by name AND address against `clubs` on 16 Sep 2026.
// `_events` / `_nightCounts` are what the harvest actually observed, kept so a
// reviewer can see why each valid_days reads the way it does.
const OFFERS = [
  {
    club_id: 'b3f7747f-d911-490d-a688-d04add6a1c8b', _club: 'Opium Barcelona',
    valid_days: 'Every night', time_window: '23:30 – 05:00',
    subtitle: 'Free guestlist · doors 23:30 · 18+',
    music: 'Top Hits · Reggaeton · House · EDM',
    _events: 76, _nightCounts: 'all seven, 10–11 each',
    _residencies: 'Holy Sh*t (Mon) · Ladies Night (Tue) · FULL PARTY (Wed) · Jet Lag (Thu) · Addicted (Fri) · Just Opium (Sat) · Mandrake (Sun)',
  },
  {
    club_id: 'd184f2f1-8db3-4d03-ae11-ad19b650894d', _club: 'Ku (formerly Pacha)',
    valid_days: 'Every night', time_window: '23:45 – 05:45',
    subtitle: 'Free guestlist · doors 23:45 · 18+',
    music: 'Reggaeton · R&B · Afrobeat · Top Hits',
    _events: 64, _nightCounts: 'Fri 14, Sat 14, Sun 10, Wed 7, Thu 7, Mon 6, Tue 6',
    _residencies: 'MONEY MONDAYS · BADASS · GUAYA PROJECT · BAE · FRIYAY · PEGAO · RED ROOM (AVALON / LA DOS / DLOCOS)',
  },
  {
    club_id: '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2', _club: 'Bling Bling Barcelona',
    valid_days: 'Wed, Thu, Fri, Sat', time_window: '00:30 – 05:00',
    subtitle: 'Free guestlist · doors 00:30 · mostly 25+, varies by night',
    music: 'Top Hits · Reggaeton · Comercial',
    _events: 61, _nightCounts: 'Wed 16, Thu 14, Fri 14, Sat 14',
    _outliers: 'Sun 2, Mon 1 — one-offs, not a residency',
    _residencies: 'Mamma x Wild (Wed) · RITA (Thu) · Friday Night · Saturday Night',
  },
  {
    club_id: 'e0cf6310-28e5-4117-ad5f-01179f87d8fd', _club: 'Sutton Club Barcelona',
    valid_days: 'Wed, Thu, Fri, Sat', time_window: '23:45 – 06:00',
    subtitle: 'Free guestlist · doors 23:45 · 23+ on most nights',
    music: 'Top Hits · Reggaeton · Pop',
    _events: 30, _nightCounts: 'Thu 8, Fri 8, Sat 7, Wed 6',
    _outliers: 'Sun 1 — one-off',
    _residencies: 'POLARIS Wednesdays · Jolie Thursdays · Fridays at Sutton · THIS IS SUTTON',
  },
  {
    club_id: '4ad56773-ffc0-4122-9dff-58bb77fb934d', _club: 'El Tardet',
    valid_days: 'Thu, Fri, Sat', time_window: '19:00 – 00:00',
    subtitle: 'Tardeo — early evening, not a club night · from 19:00 · 23+',
    music: 'Mixed',
    _events: 27, _nightCounts: 'Sat 12, Fri 9, Thu 6',
    _residencies: 'JUEVES AFTERWORK JALEO · VIERNES TARDEO JALEO · SÁBADO TARDEO JALEO',
  },
  {
    club_id: '60d6f94e-26cc-4d24-bacc-8a255e1c7924', _club: 'Downtown Barcelona',
    valid_days: 'Thu, Fri, Sat', time_window: '23:59 – 06:00',
    subtitle: 'Free guestlist · doors 23:59 · 18+',
    music: 'Reggaeton · Top Hits',
    _events: 21, _nightCounts: 'Thu 7, Fri 7, Sat 6',
    _outliers: 'Wed 1 — one-off',
    _residencies: 'WILD THURSDAY · PULSE OF FRIDAY · THE VIBE SATURDAY',
  },
  {
    club_id: '2706f18a-76ce-4276-abc0-ba53b7d6894d', _club: 'Bastian Beach',
    valid_days: 'Every night', time_window: '11:00 – 19:00',
    subtitle: 'Pool Area day access — daytime beach club, not a night out · 18+',
    music: 'Mixed',
    _events: 17, _nightCounts: 'every day',
    _residencies: 'Pool Area (daily) · Barre & Brunch',
  },
  {
    club_id: 'b9bc5258-4349-4f05-af59-6556d961524a', _club: 'Otto Zutz Club',
    valid_days: 'Thu, Fri, Sat', time_window: '00:00 – 06:00',
    subtitle: 'Free guestlist · doors midnight · 18+',
    music: 'Reggaeton · Top Hits · Underground · Hip-Hop',
    _events: 15, _nightCounts: 'Fri 7, Sat 4, Thu 2',
    _outliers: 'Wed 1, Sun 1 — one-offs',
    _residencies: 'FRIDAY BY OTTO ZUTZ · LA CASITA CLUB',
  },
  {
    club_id: 'dbf8342b-e7b8-4f27-97d2-5982bc4a3947', _club: 'Costa Breve',
    valid_days: 'Thu, Sat', time_window: '00:30 – 06:00',
    subtitle: 'Free guestlist · doors 00:30 · 21+ on Saturdays',
    music: 'Mixed',
    _events: 12, _nightCounts: 'Sat 7, Thu 5',
    _residencies: 'BLUEMOON (+21) on Sat · SUPERJUEVES Copas a 3 € on Thu',
  },
  {
    club_id: '277cd0b1-c8c5-4769-bf28-07d03f96d145', _club: 'Boris Club',
    valid_days: 'Thu, Fri, Sat', time_window: '00:30 – 06:00',
    subtitle: 'Free guestlist · doors 00:30 · 21+',
    music: 'House',
    _events: 10, _nightCounts: 'Sat 4, Thu 3, Fri 2',
    _outliers: 'Wed 1 — one-off',
    _residencies: 'booked one-offs, not a weekly night (Damian Lazarus, PAX ARABIANA)',
  },
  {
    club_id: '1a49859c-ebcf-417a-b025-3dd84bcb1d54', _club: 'La Biblio',
    valid_days: 'Wed, Thu, Fri, Sat', time_window: '00:00 – 05:00',
    subtitle: 'Free guestlist · doors midnight · 18+, 21+ on Fridays',
    music: 'Reggaeton',
    _events: 9, _nightCounts: 'Wed 3, Thu 2, Fri 2, Sat 2',
    _residencies: 'Miércoles GreenLight · Jueves COLLEGE PARTY · Viernes OFFICIAL PARTY',
  },
  {
    club_id: '3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb', _club: 'Twenties Barcelona',
    valid_days: 'Fri, Sat', time_window: '00:00 – 06:00',
    subtitle: 'Free guestlist · doors midnight · 18+',
    music: 'Reggaeton · Top Hits · House · Comercial',
    _events: 9, _nightCounts: 'Fri 7, Sat 2',
    _residencies: 'PLAYFUL (Fri) · CLASSIC XX’ (Sat)',
  },
  {
    club_id: 'fb8a09e0-6a79-4023-b990-6a0702d88053', _club: 'La Fira Provença',
    valid_days: 'Sat', time_window: '18:00 – 03:30',
    subtitle: 'Tardeo XXL — 80s/90s/00s, from 18:00 · 40+',
    music: 'Disco',
    _events: 7, _nightCounts: 'Sat 7',
    _residencies: 'TARDEO XXL LA FIRA PROVENÇA 80S 90S 00S',
  },
  {
    club_id: '00e3f149-bd90-4180-83f9-a79ebf71ab8f', _club: 'HYPE Barcelona',
    valid_days: 'Wed, Thu, Fri', time_window: '00:00 – 05:00',
    subtitle: 'Free guestlist · student nights · doors midnight',
    music: 'Reggaeton · Top Hits',
    _events: 6, _nightCounts: 'Thu 3, Fri 2, Wed 1',
    _residencies: 'HYPE x SOMFESTES (UPC / UB) · HYPE FRIDAYS',
  },
  {
    club_id: 'f710a3a3-c84e-408a-a061-d6791215848a', _club: 'La Fira Casanova',
    valid_days: 'Fri, Sat', time_window: '23:45 – 05:30',
    subtitle: 'Free guestlist · doors 23:45 · 18+',
    music: 'Reggaeton · Top Hits · Dance · Comercial',
    _events: 4, _nightCounts: 'Fri 2, Sat 2',
    _residencies: 'La Fira Casanova · Friday / · Saturday',
  },
  {
    club_id: '5eaaf6ad-c479-4e7e-b735-f3459b319aac', _club: 'La Fira Villarroel',
    valid_days: 'Fri, Sat', time_window: '00:00 – 05:30',
    subtitle: 'Free guestlist · doors midnight · 18+',
    music: 'Reggaeton · Pop · Disco · Comercial · Old-School',
    _events: 3, _nightCounts: 'Sat 2, Fri 1',
    _residencies: 'La Fira Villaroel · Saturday / · FRIDAY AT MIDNIGHT',
  },
  {
    club_id: 'cd260c75-6a5e-464e-a24d-48155b6d0c5a', _club: 'Duvet Barcelona',
    valid_days: 'Fri, Sat', time_window: '23:30 – 05:00',
    subtitle: 'Free guestlist · doors 23:30',
    music: 'Top Hits · Reggaeton · Disco',
    _events: 2, _nightCounts: 'Fri 1, Sat 1',
    _thin: 'only 2 observed dates — confirm with BesoList before relying on it',
  },
  {
    club_id: '018e3c22-f309-4555-82da-19e425c927fd', _club: '4 latas',
    valid_days: 'Wed, Fri', time_window: '20:00 – 05:30',
    subtitle: 'Free guestlist · from 20:00 · 23+',
    music: 'Reggaeton · Top Hits · Flamenco',
    _events: 2, _nightCounts: 'Wed 1, Fri 1',
    _thin: 'only 2 observed dates — confirm with BesoList before relying on it',
  },
]

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Brand ────────────────────────────────────────────────────────────────────
let brand = (await sb.from('partner_brands').select('*').eq('key', BRAND.key).maybeSingle()).data

if (!brand) {
  console.log(`brand "${BRAND.name}" (${BRAND.key}) — NOT PRESENT, would create`)
  if (APPLY) {
    // is_active:false deliberately. That flag names the single fallback brand
    // for app versions too old to read per-offer branding; it is NOT an on
    // switch, and offers go live on their own is_active. See partner.ts.
    const { data, error } = await sb.from('partner_brands')
      .insert({ ...BRAND, is_active: false })
      .select('*').single()
    if (error) { console.error('! could not create brand:', error.message); process.exit(1) }
    brand = data
    console.log(`  + created ${brand.id}`)
  }
} else {
  console.log(`brand "${brand.name}" (${brand.key}) — present ${brand.id}`)
  if (brand.offers_hidden) console.log('  ! offers_hidden is ON — these offers will NOT reach the app until it is turned off')
}

if (!brand) {
  console.log('\nDRY RUN — no brand yet, so offers cannot be resolved. Re-run with --apply.')
  printPlan()
  process.exit(0)
}

// ── Offers ───────────────────────────────────────────────────────────────────
const existing = (await sb.from('partner_offers').select('*').eq('brand_id', brand.id)).data ?? []
const keyOf = o => `${o.club_id}|${o.kind}`
const byKey = new Map(existing.map(o => [keyOf(o), o]))

function rowFor(o, i) {
  return {
    brand_id:    brand.id,
    club_id:     o.club_id,
    kind:        'free_guestlist',
    title:       'Free Guestlist',
    subtitle:    o.subtitle,
    price_eur:   null,          // free_guestlist rows are refused with a price
    party_size:  null,
    time_window: o.time_window,
    valid_days:  o.valid_days,
    dress_code:  DRESS_DEFAULT,
    music:       o.music,
    sort_order:  i,
    is_active:   true,
    capacity:    null,          // no limit until BesoList tells us their caps
  }
}

printPlan()

function printPlan() {
  console.log(`\n${OFFERS.length} offers across ${new Set(OFFERS.map(o => o.club_id)).size} venues\n`)
  for (const o of OFFERS) {
    const hit = brand ? byKey.get(`${o.club_id}|free_guestlist`) : null
    const mark = hit ? '~' : '+'
    console.log(`  ${mark} ${o._club.padEnd(30)} ${o.valid_days.padEnd(22)} ${o.time_window.padEnd(16)} ${String(o._events).padStart(3)} ev  ${o.music}`)
    if (o._outliers) console.log(`      dropped: ${o._outliers}`)
    if (o._thin)     console.log(`      thin:    ${o._thin}`)
  }
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  console.log('dress_code on every row is the house default, not BesoList\'s own.')
  process.exit(0)
}

let created = 0, updated = 0
for (const [i, o] of OFFERS.entries()) {
  const row = rowFor(o, i)
  const hit = byKey.get(keyOf(row))
  if (hit) {
    const { error } = await sb.from('partner_offers').update(row).eq('id', hit.id)
    if (error) { console.error(`  ! ${o._club}: ${error.message}`); continue }
    console.log(`  ~ ${o._club} updated`)
    updated++
  } else {
    const { data, error } = await sb.from('partner_offers').insert(row).select('id').single()
    if (error) { console.error(`  ! ${o._club}: ${error.message}`); continue }
    console.log(`  + ${o._club} ${data.id}`)
    created++
  }
}
console.log(`\ndone — ${created} created, ${updated} updated`)
console.log('Offers are LIVE unless partner_brands.offers_hidden is on for this brand.')
