// ─────────────────────────────────────────────────────────────────────────────
// import-hypelist.mjs — stand up HypeList as a promoter: their brand + their
// per-venue club offers.
//
// HypeList Barcelona (hypelistbarcelona.com) run free guestlists and VIP tables
// aimed at tourists, Erasmus students and international groups. Their site was
// read on 17 Sep 2026.
//
//   node --env-file=.env.local scripts/import-hypelist.mjs           # dry run
//   node --env-file=.env.local scripts/import-hypelist.mjs --apply   # write
//
// Idempotent: the brand is matched on `key`, each offer on
// (brand_id, club_id, kind). Re-running updates in place.
//
// ── HOW THIS DIFFERS FROM BESOLIST, WHICH MATTERS ────────────────────────────
//
// BesoList sold through Fourvenues, whose public embed exposed a real calendar:
// 383 dated events with times, from which their residencies were counted. HYPE
// PUBLISH NOTHING OF THE KIND. Their site is a Framer marketing page: nine
// venue pages, a tickets page, and a "Choose Your Night" day picker.
//
// THE DAY PICKER IS DECORATIVE. Clicking each of Monday…Sunday was verified to
// render the identical four cards (Sutton, Opium, Downtown, Pacha, looped) —
// the tabs are plain divs with no distinct panel behind them. So HypeList's own
// site cannot tell us which nights they run where, and inventing it would send
// a guest to a club that is shut.
//
// WHERE valid_days AND time_window ACTUALLY COME FROM: the BesoList harvest of
// the SAME ROOMS. A venue's operating nights are a property of the venue, not
// of whoever fills it — Bling Bling runs Wed–Sat whoever is listing it. Each
// row below records its source in `_nightsFrom`.
//
// THREE OF THE NINE VENUES ARE THEREFORE NOT IMPORTED. Jamboree, Shôko and CDLC
// are not in the BesoList set, have no scraped RA listings to infer from
// (checked: Jamboree 0, Shôko 0, CDLC 2 past Saturdays), and their
// clubs.opening_hours are Google's restaurant hours — Shôko "11:00 AM – 6:00 AM
// daily" is the restaurant, not the club night. They are listed in HELD below,
// ready to uncomment the moment HypeList tell us their nights.
//
// Other decisions:
//
//   * dress_code IS HypeList's own, unlike BesoList where we had to fall back
//     on the house default. Every venue page publishes one.
//
//   * music is HypeList's own claim about their own nights, taken from the
//     venue page's Club Information block and widened where their tickets page
//     is more specific (Shôko, Downtown).
//
//   * MINIMUM AGE AND THE FREE-ENTRY CUT-OFF RIDE IN THE SUBTITLE.
//     `partner_offers` has no column for either, and both are what a guest
//     needs to know before turning up. Ages are from the tickets page; Sutton
//     publishes "+19-23-25" (it varies by night) and is written as such rather
//     than flattened to one number.
//
//   * kind = 'free_guestlist' everywhere. HypeList do sell VIP tables — every
//     venue page says "VIP Tables: Available" — but publish no prices, and
//     vip_table rows are refused without one (portal-schemas.ts). That is a
//     separate import once we have their table inventory.
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
  // Their own accent, sampled from the site's WhatsApp button. This tints the
  // promoter's credit/logo only — it is never the app accent, which stays gold.
  color: '#814AC8',
  login_email: 'hypelist@clubfuoco.com',
}

// club_id verified by name against `clubs` on 17 Sep 2026.
// `_nightsFrom` records where valid_days/time_window came from, because it is
// NOT HypeList — see the header.
const OFFERS = [
  {
    club_id: 'b3f7747f-d911-490d-a688-d04add6a1c8b', _club: 'Opium Barcelona',
    valid_days: 'Every night', time_window: '23:30 – 05:00',
    subtitle: 'Free guestlist · free entry until 01:00 · doors 23:30 · 18+',
    music: 'Top Hits · Reggaeton · R&B',
    dress_code: 'Elegant/casual',
    _nightsFrom: 'BesoList harvest — same room, every night, 23:30–05:00',
  },
  {
    club_id: 'd184f2f1-8db3-4d03-ae11-ad19b650894d', _club: 'Ku (formerly Pacha)',
    valid_days: 'Every night', time_window: '23:45 – 05:45',
    subtitle: 'Free guestlist · free entry until 01:00 · doors 23:45 · 18+',
    music: 'Top Hits · Reggaeton',
    dress_code: 'Smart casual',
    // HypeList still market this room as "Pacha Barcelona"; our canonical row
    // is "Ku (formerly Pacha)" and the app shows the canonical name.
    _nightsFrom: 'BesoList harvest — same room, every night, 23:45–05:45',
  },
  {
    club_id: '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2', _club: 'Bling Bling Barcelona',
    valid_days: 'Wed, Thu, Fri, Sat', time_window: '00:30 – 05:00',
    subtitle: 'Free guestlist · doors 00:30',
    music: 'Top Hits · Reggaeton',
    dress_code: 'Smart casual',
    _nightsFrom: 'BesoList harvest — Wed 16, Thu 14, Fri 14, Sat 14',
  },
  {
    club_id: 'e0cf6310-28e5-4117-ad5f-01179f87d8fd', _club: 'Sutton Club Barcelona',
    valid_days: 'Wed, Thu, Fri, Sat', time_window: '23:45 – 06:00',
    subtitle: 'Free guestlist · free entry until 01:00 · doors 23:45 · 19+, higher on some nights',
    music: 'Top Hits · House · Reggaeton',
    dress_code: 'Elegant',
    _nightsFrom: 'BesoList harvest — Thu 8, Fri 8, Sat 7, Wed 6',
  },
  {
    club_id: '60d6f94e-26cc-4d24-bacc-8a255e1c7924', _club: 'Downtown Barcelona',
    valid_days: 'Thu, Fri, Sat', time_window: '23:59 – 06:00',
    subtitle: 'Free guestlist · free entry until 01:00 · 18+',
    music: 'Reggaeton · R&B · Top Hits',
    dress_code: 'Smart casual',
    _nightsFrom: 'BesoList harvest — Thu, Fri, Sat',
  },
  {
    club_id: '3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb', _club: 'Twenties Barcelona',
    valid_days: 'Fri, Sat', time_window: '00:00 – 06:00',
    subtitle: 'Free guestlist · free entry until 01:00 · 18+',
    music: 'Reggaeton · Top Hits',
    dress_code: 'Smart casual',
    _nightsFrom: 'BesoList harvest — Fri, Sat',
  },
]

// Advertised by HypeList, deliberately NOT imported: we do not know which
// nights they run there, and a guestlist promising a night the room is shut is
// worse than no listing. Uncomment with real nights when HypeList confirm.
const HELD = [
  { club_id: 'a83428e5-5c7f-4f55-99e5-3f329f7c3210', club: 'Jamboree',
    dress_code: 'Casual', music: 'Urban · R&B · Hip Hop',
    why: 'not in BesoList set; 0 scraped listings; Google hours are the venue bar (16:00–05:00 daily)' },
  { club_id: 'ddca5d10-9b4f-47c4-81a2-2c36bef77e49', club: 'Shôko',
    dress_code: 'Smart casual', music: 'Hip-Hop · R&B · Reggaeton · EDM',
    why: 'not in BesoList set; 0 scraped listings; Google hours (11:00–06:00 daily) are the restaurant' },
  { club_id: 'd649395c-d3db-4397-b200-42b575d1738a', club: 'CDLC Barcelona (Carpe Diem)',
    dress_code: 'Smart casual', music: 'Top Hits · House',
    why: 'not in BesoList set; only 2 scraped listings, both past Saturdays — not a residency' },
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
    //
    // offers_hidden:true deliberately too. A brand imported from a website
    // should not start selling to guests the moment this script runs — every
    // other supplier on the platform is currently muted, and going live is an
    // operator decision made in the portal, not a side effect of an import.
    const { data, error } = await sb.from('partner_brands')
      .insert({ ...BRAND, is_active: false, offers_hidden: true })
      .select('*').single()
    if (error) { console.error('! could not create brand:', error.message); process.exit(1) }
    brand = data
    console.log(`  + created ${brand.id}  (offers_hidden ON — nothing reaches guests yet)`)
  }
} else {
  console.log(`brand "${brand.name}" (${brand.key}) — present ${brand.id}`)
  if (brand.offers_hidden) console.log('  · offers_hidden is ON — these offers will NOT reach the app until it is turned off')
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
    dress_code:  o.dress_code,  // HypeList's own, not the house default
    music:       o.music,
    sort_order:  i,
    is_active:   true,
    capacity:    null,          // no limit until HypeList tell us their caps
  }
}

printPlan()

function printPlan() {
  console.log(`\n${OFFERS.length} offers across ${new Set(OFFERS.map(o => o.club_id)).size} venues\n`)
  for (const o of OFFERS) {
    const hit = brand ? byKey.get(`${o.club_id}|free_guestlist`) : null
    console.log(`  ${hit ? '~' : '+'} ${o._club.padEnd(24)} ${o.valid_days.padEnd(20)} ${o.time_window.padEnd(16)} ${o.dress_code.padEnd(15)} ${o.music}`)
    console.log(`      nights: ${o._nightsFrom}`)
  }
  console.log(`\n${HELD.length} advertised venues HELD BACK — no night data:\n`)
  for (const h of HELD) console.log(`  · ${h.club.padEnd(28)} ${h.why}`)
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
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
console.log('offers_hidden is ON for this brand: nothing reaches guests until you turn it off in the portal.')
