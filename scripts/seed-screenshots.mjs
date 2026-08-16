// Demo-data seeder for App Store screenshots — promoter account
// shehehe@clubfuoco.com (uid f5bc4b3e-…).
//
// Guestlist-stats-only: writes ONLY promoter-owned tables + partner_offers
// listings. Touches NO consumer tables (bookings / rumbalist_purchases).
//
// Uses FICTIONAL venues (created here as is_active=false, is_partner=false so
// they never appear in the consumer app, feeds, or the venue picker) — no real
// club names in marketing screenshots. Idempotent: clears prior seeded rows
// first. Service-role writes auto-approve via the hold/rehold triggers.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const root = '/Users/yakovvinnik/Clubfuoco'
const env = Object.fromEntries(readFileSync(root + '/.env.local', 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL = env.NEXT_PUBLIC_SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' }

const UID = 'f5bc4b3e-c29c-44e0-8d8b-e181cd90de00'
const BRAND_ID = '75395555-51d0-40cc-895b-111eacccaa41'
const BRAND_NAME = 'Nova Nights'
const IG = 'novanights.bcn'

async function j(method, path, body, extra) {
  const r = await fetch(`${URL}${path}`, { method, headers: { ...H, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  if (r.status >= 300) console.error(`  ! ${method} ${path.split('?')[0]} -> ${r.status}`, JSON.stringify(b).slice(0, 300))
  return { status: r.status, body: b }
}
const rep = { Prefer: 'return=representation' }

// ── fictional venues (invented — no real business) ─────────────────────────
// Slug carries a `demo-` prefix so they're easy to find/remove and can't
// collide with a real venue slug. is_active:false + is_partner:false keeps
// them out of every consumer surface.
const DEMO_CLUBS = [
  { slug: 'demo-aurora-beach',  name: 'Aurora Beach Club', address: 'Port Olímpic, Barcelona',    lat: 41.3865, lng: 2.1975 },
  { slug: 'demo-marina-08',     name: 'Marina 08',         address: 'Passeig Marítim, Barcelona', lat: 41.3792, lng: 2.1935 },
  { slug: 'demo-velvet-room',   name: 'Velvet Room',       address: 'Eixample, Barcelona',        lat: 41.3915, lng: 2.1650 },
  { slug: 'demo-club-lumiere',  name: 'Club Lumière',      address: 'El Born, Barcelona',         lat: 41.3845, lng: 2.1820 },
  { slug: 'demo-sky-terrace',   name: 'Sky Terrace BCN',   address: 'Diagonal, Barcelona',        lat: 41.3925, lng: 2.1490 },
  { slug: 'demo-terraza-eden',  name: 'Terraza Edén',      address: 'Gràcia, Barcelona',          lat: 41.4020, lng: 2.1560 },
]

// filled at runtime → slug alias => club id
const CLUB = {}
// club id => display name. The demo clubs are is_active=false, so the app's
// RLS-scoped reads can't see their names (they'd show "Custom location"). We
// stamp each night/series with location_name so the venue name renders without
// exposing the fake clubs to the consumer app.
const CLUB_NAME = {}

// ── date helpers (relative to run time, or an explicit demo day) ───────────
// Pass a target "today" as DEMO_DATE=YYYY-MM-DD (env) or argv[2] so the
// "tonight" event and this-month stats anchor to the DEMO day, not the run
// day. Noon-local avoids any UTC date rollover.
const fmt = d => d.toISOString().slice(0, 10)
const demoArg = process.env.DEMO_DATE || process.argv[2]
const now = demoArg ? new Date(`${demoArg}T12:00:00`) : new Date()
const dayOf = now.getDate()
const at = n => { const d = new Date(now); d.setDate(dayOf + n); return d }
const monthDay = n => new Date(now.getFullYear(), now.getMonth(), n)
const lastMonth = n => new Date(now.getFullYear(), now.getMonth() - 1, n)
const past = (early, back) => dayOf > 4 ? monthDay(early) : at(back)

const TODAY = fmt(now)
const N_TONIGHT = TODAY
const N_PAST1 = fmt(past(1, -4))
const N_PAST2 = fmt(past(2, -3))
const N_PAST3 = fmt(past(4, -1))
const N_UP1   = fmt(at(2))
const N_UP2   = fmt(at(3))
const N_LAST  = fmt(lastMonth(26))

// ── name pool ──────────────────────────────────────────────────────────────
const FIRST = ['Lucía','Mateo','Sofía','Hugo','Martina','Diego','Valentina','Pablo','Carla','Álvaro','Emma','Bruno','Julia','Marc','Nora','Leo','Alba','Iker','Daniela','Adrián','Chloé','Marco','Aitana','Nil','Paula','Enzo','Vera','Gael','Noa','Pol','Isabella','Thiago','Jana','Biel','Lola','Aleix','Ona','Izan','Candela','Roc','Ariadna','Unai','Elsa','Arnau','Greta','Max','Frida','Rayan','Zoe','Dylan','Amira','Youssef','Nina','Omar','Sara','Liam','Emily','Karim','Aya','Luca']
const LAST = ['García','Martínez','López','Sánchez','Romero','Torres','Ferrer','Vidal','Serra','Roca','Costa','Bosch','Núñez','Iglesias','Molina','Ortega','Reyes','Cano','Bauer','Rossi','Dubois','Khan','Haddad','Silva','Moreau','Ferrari','Weber','Nguyen','Okafor','Petrov']
let ni = 7, li = 3
const name = () => { ni = (ni * 7 + 13) % FIRST.length; li = (li * 5 + 11) % LAST.length; return `${FIRST[ni]} ${LAST[li]}` }
const NOTES = [null, null, null, 'Birthday 🎂', 'Table by DJ booth', 'VIP list', null, 'Friends of the house', null, 'Bringing a group', null]
let noteIdx = 0
const note = () => NOTES[(noteIdx = (noteIdx + 3) % NOTES.length)]

function buildGuests(allocId, nightDate, targetHeads, arrivedFrac) {
  const rows = []
  let heads = 0
  while (heads < targetHeads) {
    const plus = [0, 0, 0, 1, 1, 2][Math.floor(((heads * 37) % 6))]
    rows.push({ id: randomUUID(), allocation_id: allocId, full_name: name(), plus_ones: plus, note: note(), checked_in_at: null,
                created_at: new Date(new Date(nightDate).getTime() - (rows.length * 6 + 40) * 60000).toISOString() })
    heads += 1 + plus
  }
  const arrivedTarget = Math.round(targetHeads * arrivedFrac)
  let arrived = 0
  const checkinBase = new Date(`${nightDate}T23:30:00Z`).getTime()
  for (const r of rows) {
    if (arrived >= arrivedTarget) break
    r.checked_in_at = new Date(checkinBase + Math.floor(Math.random() * 150) * 60000).toISOString()
    arrived += 1 + r.plus_ones
  }
  return rows
}

async function ensureClubs() {
  for (const c of DEMO_CLUBS) {
    const found = await j('GET', `/rest/v1/clubs?slug=eq.${c.slug}&select=id`)
    let id = found.body?.[0]?.id
    if (!id) {
      const ins = await j('POST', '/rest/v1/clubs',
        { id: randomUUID(), ...c, neighborhood: null, is_active: false, is_featured: false, is_partner: false }, rep)
      id = ins.body?.[0]?.id
    }
    CLUB[c.slug.replace('demo-', '')] = id
    CLUB_NAME[id] = c.name
  }
}

async function main() {
  console.log('Run date:', TODAY)
  await ensureClubs()
  console.log('✓ fictional venues ready:', DEMO_CLUBS.map(c => c.name).join(', '))

  // Spec arrays built here (need CLUB populated first) -----------------------
  const NIGHTS = [
    { club: CLUB['terraza-eden'], title: 'Edén Live',            date: N_TONIGHT, payout: 10, spots: 80,  heads: 47, arr: 0.42, open: '23:00:00', close: '06:00:00', theme: 'Open-air house & techno' },
    { club: CLUB['club-lumiere'], title: 'Reggaeton Saturdays',  date: N_PAST1,   payout: 10, spots: 90,  heads: 88, arr: 0.92, open: '23:30:00', close: '06:00:00', theme: 'Reggaeton · Latin · Hits' },
    { club: CLUB['sky-terrace'],  title: 'Sunday Rooftop',       date: N_PAST2,   payout: 12, spots: 70,  heads: 58, arr: 0.88, open: '23:00:00', close: '05:30:00', theme: 'Rooftop sessions' },
    { club: CLUB['velvet-room'],  title: 'Velvet Members Night', date: N_PAST3,   payout: 15, spots: 50,  heads: 42, arr: 0.90, open: '23:30:00', close: '06:00:00', theme: 'R&B · Commercial House' },
    { club: CLUB['aurora-beach'], title: 'Sunset Sessions',      date: N_UP1,     payout: 10, spots: 100, heads: 37, arr: 0.0,  open: '18:00:00', close: '02:00:00', theme: 'Beach club sunset' },
    { club: CLUB['marina-08'],    title: 'Marina Saturdays',     date: N_UP2,     payout: 12, spots: 80,  heads: 29, arr: 0.0,  open: '23:00:00', close: '06:00:00', theme: 'Waterfront reggaeton' },
    { club: CLUB['aurora-beach'], title: 'Sunset Sessions',      date: N_LAST,    payout: 10, spots: 150, heads: 122,arr: 0.90, open: '18:00:00', close: '02:00:00', theme: 'Beach club sunset' },
  ]
  const SERIES = [
    { club: CLUB['velvet-room'], title: 'Nova Wednesdays', weekdays: [4],    spots: 60, payout: 12, open: '23:30:00', close: '06:00:00', theme: 'Midweek members night' },
    { club: CLUB['marina-08'],   title: 'Nova Weekends',   weekdays: [6, 7], spots: 80, payout: 12, open: '23:00:00', close: '06:00:00', theme: 'Weekend waterfront' },
  ]
  const OFFERS = [
    { club: CLUB['aurora-beach'], kind: 'vip_table',      title: 'VIP Table',      subtitle: 'From €400 · 6 people · Fully consumable on bottles', price_eur: 400, party_size: 6, time_window: 'Reservation for the night', valid_days: 'Fri – Sun', dress_code: 'Smart elegant — no sportswear', music: 'Beach house · Commercial · Hits', sort_order: 0 },
    { club: CLUB['aurora-beach'], kind: 'free_guestlist', title: 'Free Guestlist', subtitle: 'Free entry till 1:00 AM',                            price_eur: null, party_size: null, time_window: 'Door open till closing', valid_days: 'Every night', dress_code: 'Smart casual', music: 'Reggaeton · Top Hits · House', sort_order: 1 },
    { club: CLUB['marina-08'],    kind: 'free_guestlist', title: 'Free Guestlist', subtitle: 'Free till 01:30 AM',                                 price_eur: null, party_size: null, time_window: 'Door open till closing', valid_days: 'Thu – Sat', dress_code: 'Smart casual — no sportswear', music: 'Reggaeton · Hip Hop · R&B · House', sort_order: 0 },
    { club: CLUB['velvet-room'],  kind: 'vip_table',      title: 'VIP Table',      subtitle: 'From €300 · 5 people · Fully consumable on bottles', price_eur: 300, party_size: 5, time_window: 'Reservation for the night', valid_days: 'Wed · Fri · Sat', dress_code: 'Smart elegant', music: 'R&B · Commercial House · Hits', sort_order: 0 },
    { club: CLUB['club-lumiere'], kind: 'vip_table',      title: 'VIP Table',      subtitle: 'From €300 · 5 people · Fully consumable on bottles', price_eur: 300, party_size: 5, time_window: 'Reservation for the night', valid_days: 'Every night', dress_code: 'Smart elegant', music: 'Reggaeton · Commercial · R&B', sort_order: 0 },
  ]

  // 0) Identity --------------------------------------------------------------
  await j('PATCH', `/rest/v1/users?id=eq.${UID}`, { full_name: BRAND_NAME })
  await j('PATCH', `/rest/v1/promoter_profiles?user_id=eq.${UID}`, { brand_name: BRAND_NAME, instagram: IG, bio: 'Premium nightlife guestlists across Barcelona.' })
  await j('PATCH', `/rest/v1/partner_brands?id=eq.${BRAND_ID}`, { name: BRAND_NAME })
  console.log('✓ identity set to', BRAND_NAME)

  // 1) Clear prior seeded rows -----------------------------------------------
  const oldAllocs = (await j('GET', `/rest/v1/promoter_allocations?promoter_id=eq.${UID}&select=id`)).body || []
  for (const a of oldAllocs) await j('DELETE', `/rest/v1/promoter_guests?allocation_id=eq.${a.id}`)
  await j('DELETE', `/rest/v1/promoter_allocations?promoter_id=eq.${UID}`)
  await j('DELETE', `/rest/v1/promoter_nights?created_by=eq.${UID}`)
  await j('DELETE', `/rest/v1/promoter_series?promoter_id=eq.${UID}`)
  await j('DELETE', `/rest/v1/partner_offers?brand_id=eq.${BRAND_ID}`)
  console.log('✓ cleared prior seeded rows')

  // 2) Nights + allocations + guests -----------------------------------------
  let totHeads = 0, totArr = 0, monthEarn = 0
  for (const n of NIGHTS) {
    const nightRow = {
      id: randomUUID(), club_id: n.club, location_name: CLUB_NAME[n.club] ?? null,
      title: n.title, night_date: n.date,
      open_time: n.open, close_time: n.close, total_capacity: n.spots, is_published: true,
      review_status: 'approved', auto_checkin: false, theme: n.theme, theme_translate: false,
      photo_urls: [], featured: false, max_plus_ones: 4, created_by: UID,
    }
    const ni2 = await j('POST', '/rest/v1/promoter_nights', nightRow, rep)
    if (ni2.status >= 300) continue
    const nightId = ni2.body[0].id
    const ai = await j('POST', '/rest/v1/promoter_allocations',
      { id: randomUUID(), night_id: nightId, promoter_id: UID, spots: n.spots, payout_per_guest: n.payout, payout_status: 'pending', group_visible: true }, rep)
    if (ai.status >= 300) continue
    const allocId = ai.body[0].id
    const guests = buildGuests(allocId, n.date, n.heads, n.arr)
    for (let k = 0; k < guests.length; k += 100) await j('POST', '/rest/v1/promoter_guests', guests.slice(k, k + 100), { Prefer: 'return=minimal' })
    const heads = guests.reduce((s, g) => s + 1 + g.plus_ones, 0)
    const arr = guests.filter(g => g.checked_in_at).reduce((s, g) => s + 1 + g.plus_ones, 0)
    const thisMonth = n.date.slice(0, 7) === TODAY.slice(0, 7)
    if (thisMonth) { totHeads += heads; totArr += arr; monthEarn += heads * n.payout }
    console.log(`  night ${n.date} ${n.title.padEnd(22)} heads=${heads} arrived=${arr}${thisMonth ? ' [month]' : ''}`)
  }

  // 3) Series ----------------------------------------------------------------
  for (const s of SERIES) {
    const r = await j('POST', '/rest/v1/promoter_series', {
      id: randomUUID(), promoter_id: UID, club_id: s.club, location_name: CLUB_NAME[s.club] ?? null,
      title: s.title, weekdays: s.weekdays,
      open_time: s.open, close_time: s.close, spots: s.spots, payout_per_guest: s.payout,
      group_visible: true, invite_token: randomUUID().replace(/-/g, '').slice(0, 20), is_active: true,
      review_status: 'approved', auto_checkin: false, theme: s.theme, theme_translate: false,
      photo_urls: [], featured: false, max_plus_ones: 4,
    }, rep)
    if (r.status < 300) console.log(`  series ${s.title}`)
  }

  // 4) Offers ----------------------------------------------------------------
  const offerRows = OFFERS.map(({ club, ...o }) => ({ id: randomUUID(), brand_id: BRAND_ID, club_id: club, ...o, is_active: true }))
  const or = await j('POST', '/rest/v1/partner_offers', offerRows, { Prefer: 'return=minimal' })
  console.log(`  offers inserted: ${or.status} (${offerRows.length} rows)`)

  console.log('\n── STATS HEADLINE (this month) ──')
  console.log(`  Guests:    ${totHeads}`)
  console.log(`  Arrived:   ${totArr}  (check-in ${Math.round(totArr / totHeads * 100)}%)`)
  console.log(`  Earnings:  €${monthEarn.toLocaleString()}`)
}
main().catch(e => { console.error(e); process.exit(1) })
