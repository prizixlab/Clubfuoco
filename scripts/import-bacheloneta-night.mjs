// ─────────────────────────────────────────────────────────────────────────────
// import-bacheloneta-night.mjs — add D9 Aribau to `clubs`, load Bacheloneta's
// 9 Oct night as a promoter_nights route, and set their Instagram.
//
//   node --env-file=.env.local scripts/import-bacheloneta-night.mjs          # dry run
//   node --env-file=.env.local scripts/import-bacheloneta-night.mjs --apply
//
// Run scripts/provision-bacheloneta.mjs --apply first (brand + owner account).
//
// Source: the Fourvenues public embed, read 5 Oct 2026 —
//   site.fourvenues.com/en/iframe/siroko/events/Z0GF
// The night is co-promoted on SIROKO's org; Bacheloneta have none of their own.
//
// Decisions worth knowing:
//
//   * D9 ARIBAU IS A NEW ROW, NOT THE EXISTING "D9". That row (11fc3bc7…) is
//     Carrer de Pallars 122 in Poblenou; D9 Aribau is Carrer d'Aribau 242
//     (Places ChIJyX-D9XKjpBIRU9GlQ0egEvc, types bar). Same chain name, a
//     different room across the city. Places-enriched exactly like
//     add-besolist-venues.mjs; idempotent on google_place_id.
//
//   * ONE NIGHT, TWO STOPS. The source is literally "D9 Aribau → SECRET CLUB",
//     which is what `stops` exists for (20260908_event_stops.sql): one
//     reservation, one pass. club_id / open_time / close_time are derived from
//     the stops the same way /api/portal/events derives them. The club is
//     unnamed on purpose by the promoter, so its stop has club_id null.
//
//   * price_cents 0, AND THE TICKET PRICE IS IN THE DESCRIPTION. Fourvenues
//     sells it at €5 early bird / €7 general. A priced night is refused by
//     promoter_nights_price_guard until the owner has Stripe payouts AND a
//     verified card, and Bacheloneta has neither. So the price can't live in
//     price_cents yet; it goes where a guest reads it, plus the `fourvenues`
//     snapshot (portal display), so nobody turns up thinking it's free.
//
//   * review_status forced to 'approved' after insert — an operator load, not
//     a promoter submission. Same as every other import here.
//
// Idempotent: the night is matched on fourvenues_code.
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

const INSTAGRAM = 'bacheloneta'
const VENUE = { place_id: 'ChIJyX-D9XKjpBIRU9GlQ0egEvc', name: 'D9 Aribau' }
const FV_URL = 'https://site.fourvenues.com/en/siroko/events/siroko-x-bacheloneta-international-student-social--club-night-09-10-2026-Z0GF'
const FV_IMAGE = 'https://fourvenues.com/cdn-cgi/imagedelivery/kWuoTchaMsk7Xnc_FNem7A/15cd23e0-c65c-4bbc-0d2e-5f8ac7ea1c00/w=1350'

const DESCRIPTION = [
  'Students from TBS, ESADE and EU Business School, together: a private student social at D9 Aribau, then on to a secret club.',
  '',
  'Your ticket includes:',
  '• Private access to D9 Aribau',
  '• One complimentary beer or shot',
  '• Live DJ',
  '• Basic mixed drinks €8 instead of €10 during the first hour',
  '• Free entry to the secret club before 01:00',
  '',
  'University students only — bring a valid student card or proof of enrolment; without it you may be refused entry with no refund.',
  '',
  'Tickets €5 early bird / €7 general release, sold on Fourvenues. Limited capacity; prices rise as each release sells out.',
].join('\n')

const FIELDS = [
  'place_id','name','formatted_address','geometry','types','business_status',
  'rating','user_ratings_total','website','formatted_phone_number','opening_hours','photos',
].join(',')

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Brand + owner ────────────────────────────────────────────────────────────
const { data: brand } = await sb.from('partner_brands').select('*').eq('key', 'bacheloneta').maybeSingle()
if (!brand?.owner_user_id) {
  console.error('! no bacheloneta brand with an owner — run scripts/provision-bacheloneta.mjs --apply first')
  process.exit(1)
}
const OWNER = brand.owner_user_id
console.log(`brand   ${brand.name} ${brand.id}  owner ${OWNER}`)

// ── Instagram ────────────────────────────────────────────────────────────────
console.log(`insta   @${INSTAGRAM}`)
if (APPLY) {
  const { error } = await sb.from('promoter_profiles')
    .update({ instagram: INSTAGRAM, updated_at: new Date().toISOString() }).eq('user_id', OWNER)
  if (error) { console.error('! instagram:', error.message); process.exit(1) }
}

// ── Venue ────────────────────────────────────────────────────────────────────
let clubId = (await sb.from('clubs').select('id').eq('google_place_id', VENUE.place_id).maybeSingle()).data?.id ?? null
if (clubId) {
  console.log(`club    ${VENUE.name} — present ${clubId}`)
} else {
  const j = await (await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${VENUE.place_id}&fields=${FIELDS}&key=${PLACES_KEY}`)).json()
  if (j.status !== 'OK') { console.error(`! places: ${j.status}`); process.exit(1) }
  const r = j.result
  const loc = r.geometry?.location ?? {}
  const row = {
    name:             VENUE.name,
    slug:             slugify(VENUE.name),
    address:          r.formatted_address ?? null,
    neighborhood:     'Sarrià-Sant Gervasi',
    lat:              loc.lat ?? null,
    lng:              loc.lng ?? null,
    google_place_id:  r.place_id,
    rating:           r.rating ?? null,
    ratings_total:    r.user_ratings_total ?? null,
    opening_hours:    r.opening_hours?.weekday_text ?? null,
    photos:           (r.photos ?? []).slice(0, 10).map(p => p.photo_reference),
    is_active:        true,
    is_featured:      false,
    places_synced_at: new Date().toISOString(),
  }
  console.log(`club    ${VENUE.name} — would CREATE  ${row.address}  ${r.rating ?? '–'}★ (${r.user_ratings_total ?? 0})  ${r.business_status}`)
  if (APPLY) {
    const { data, error } = await sb.from('clubs').insert(row).select('id').single()
    if (error) { console.error('! club insert:', error.message); process.exit(1) }
    clubId = data.id
    console.log(`        created ${clubId}`)
  }
}

// ── Night ────────────────────────────────────────────────────────────────────
const stops = [
  { club_id: clubId, name: 'D9 Aribau', start: '21:30', end: '00:30',
    note: 'Private student social · free beer or shot · €8 mixed drinks first hour' },
  { club_id: null, name: 'Secret club', start: '00:30', end: '06:00',
    note: 'Free entry before 01:00' },
]
const night = {
  club_id:      clubId,                  // first stop — where the guest is scanned
  title:        'SIROKO x BACHELONETA International Student Social & Club Night',
  night_date:   '2026-10-09',
  open_time:    stops[0].start,
  close_time:   stops[stops.length - 1].end,
  stops,
  description:  DESCRIPTION,
  photo_urls:   [FV_IMAGE],
  created_by:   OWNER,
  is_published: true,
  visibility:   'public',
  price_cents:  0,                       // see header: priced nights need payouts + card
  currency:     'eur',
  is_house:     false,
  featured:     false,
  fourvenues_code: 'Z0GF',
  fourvenues: {
    url: FV_URL, image: FV_IMAGE, min_age: 18, venue: 'D9 Aribau → SECRET CLUB',
    products: [
      { name: 'Early Bird Ticket', settle: 'ticket', price: 5, sold_out: false },
      { name: 'General Release',   settle: 'ticket', price: 7, sold_out: false },
    ],
  },
}
console.log(`night   ${night.night_date} ${night.open_time}–${night.close_time}  ${night.title}`)
console.log(`        route: ${stops.map(s => `${s.name} ${s.start}–${s.end}`).join(' → ')}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  process.exit(0)
}

const { data: existing } = await sb.from('promoter_nights')
  .select('id').eq('fourvenues_code', night.fourvenues_code).maybeSingle()
if (existing) {
  // Content only — publishing/review/featuring are the Events desk's.
  const { is_published, visibility, featured, ...content } = night
  const { error } = await sb.from('promoter_nights').update(content).eq('id', existing.id)
  if (error) { console.error('! night update:', error.message); process.exit(1) }
  console.log(`        updated ${existing.id}`)
} else {
  const { data, error } = await sb.from('promoter_nights').insert(night).select('id').single()
  if (error) { console.error('! night insert:', error.message); process.exit(1) }
  // The before-insert trigger parks new nights at 'pending'; lift it.
  const { error: aErr } = await sb.from('promoter_nights').update({ review_status: 'approved' }).eq('id', data.id)
  if (aErr) console.error('! approve:', aErr.message)
  console.log(`        created ${data.id}${aErr ? '' : ' (approved)'}`)
}
// `photos` above are raw Google references, which the apps refuse to render —
// and the Explore feed (so search too) drops a venue with no usable photo.
console.log('\ndone. Now run: python3 scripts/host-club-photos.py')
console.log('or the new venue stays invisible in Explore and search.')
