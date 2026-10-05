// ─────────────────────────────────────────────────────────────────────────────
// provision-bacheloneta.mjs — stand up Bacheloneta as a promoter: brand,
// account and promoter profile.
//
//   node --env-file=.env.local scripts/provision-bacheloneta.mjs          # dry run
//   node --env-file=.env.local scripts/provision-bacheloneta.mjs --apply
//
// Bacheloneta is a Barcelona student-night promoter (TBS, ESADE, EU Business
// School crowd). They have NO Fourvenues organisation of their own — the
// /iframe/bacheloneta route renders nothing. Their only public footprint is a
// co-promotion on Siroko's org, harvested from the public embed 5 Oct 2026:
//
//   SIROKO x BACHELONETA International Student Social & Club Night
//   Fri 9 Oct 2026 · private social at D9 Aribau 21:30–00:30 → "SECRET CLUB"
//   from 00:30 · 18+, university students only · tickets €5 early / €7 general
//   site.fourvenues.com/en/iframe/siroko/events/Z0GF
//
// Decisions worth knowing:
//
//   * NO OFFERS, NO NIGHTS. One co-promoted night is not a residency, and the
//     rooms don't resolve: the only D9 in `clubs` (11fc3bc7…) is on Carrer de
//     Pallars, not Aribau, and the club half is deliberately unnamed. Writing
//     a night against the wrong D9 is the kind of confident nonsense
//     import-besolist.mjs refuses to write too.
//
//   * NO INSTAGRAM. A web search found nothing that is clearly theirs; it is
//     left null rather than guessed. It's one field on the profile.
//
//   * Same conventions as BesoList: login_email on @clubfuoco.com, no email
//     sent (email_confirm: true, no password), is_active:false on the brand
//     (that flag is the legacy fallback brand, not an on switch), gold accent
//     until they give us their own, no logo until they send one.
//
// Idempotent: brand matched on `key`, account on email, profile on user_id.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

const EMAIL = 'bacheloneta@clubfuoco.com'
// Club Fuoco gold. NEVER pink — that is the retired Rumbalist mark.
const BRAND = { key: 'bacheloneta', name: 'Bacheloneta', color: '#C09950', login_email: EMAIL }
const PROFILE = {
  brand_name: 'Bacheloneta',
  bio: 'International student socials and club nights in Barcelona — meet new people, find your group, party together.',
  instagram: null,
  logo_url: null,
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Brand ────────────────────────────────────────────────────────────────────
let brand = (await sb.from('partner_brands').select('*').eq('key', BRAND.key).maybeSingle()).data
if (brand) {
  console.log(`brand  ${brand.name} — present ${brand.id}`)
} else if (!APPLY) {
  console.log(`brand  ${BRAND.name} (${BRAND.key}) — would CREATE`)
} else {
  const { data, error } = await sb.from('partner_brands')
    .insert({ ...BRAND, is_active: false }).select('*').single()
  if (error) { console.error('! brand:', error.message); process.exit(1) }
  brand = data
  console.log(`brand  created ${brand.id}`)
}

// ── Account ──────────────────────────────────────────────────────────────────
// listUsers is paged; the admin API has no get-by-email, so scan for it.
let uid = null
for (let page = 1; page <= 20 && !uid; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) { console.error('! listUsers:', error.message); process.exit(1) }
  const hit = (data?.users ?? []).find(u => (u.email ?? '').toLowerCase() === EMAIL)
  if (hit) uid = hit.id
  if (!data?.users?.length || data.users.length < 1000) break
}

if (uid) {
  console.log(`auth   ${EMAIL} — already exists ${uid}`)
} else if (!APPLY) {
  console.log(`auth   ${EMAIL} — would CREATE (no email sent)`)
} else {
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,                 // suppress Supabase's own confirm mail
    user_metadata: { full_name: BRAND.name },
  })
  if (error) { console.error('! createUser:', error.message); process.exit(1) }
  uid = data.user.id
  console.log(`auth   created ${uid}`)
}

console.log(`profile ${PROFILE.brand_name} — "${PROFILE.bio}"`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  process.exit(0)
}

// ── Promoter flags ───────────────────────────────────────────────────────────
// A trigger may already have inserted the users row on auth creation.
const { error: uErr } = await sb.from('users')
  .upsert({ id: uid, email: EMAIL, full_name: BRAND.name, account_kind: 'promoter', is_promoter: true },
          { onConflict: 'id' })
if (uErr) { console.error('! users upsert:', uErr.message); process.exit(1) }
console.log(`users  ${uid} → account_kind=promoter, is_promoter=true`)

// ── Profile ──────────────────────────────────────────────────────────────────
const { error: pErr } = await sb.from('promoter_profiles')
  .upsert({ user_id: uid, ...PROFILE, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
if (pErr) { console.error('! promoter_profiles:', pErr.message); process.exit(1) }
console.log('profile written')

// ── Link the brand ───────────────────────────────────────────────────────────
// One login owns exactly one brand (getBrandByOwner uses .maybeSingle()).
const { data: clash } = await sb.from('partner_brands')
  .select('id,name').eq('owner_user_id', uid).neq('id', brand.id).maybeSingle()
if (clash) {
  console.error(`! that account already owns "${clash.name}" (${clash.id}) — not linking`)
  process.exit(1)
}
if (brand.owner_user_id === uid) {
  console.log('brand  already linked')
} else {
  const { error: bErr } = await sb.from('partner_brands')
    .update({ owner_user_id: uid, login_email: EMAIL }).eq('id', brand.id)
  if (bErr) { console.error('! brand link:', bErr.message); process.exit(1) }
  console.log(`brand  linked owner_user_id=${uid}`)
}

console.log('\ndone. No email was sent — use the portal\'s "Send password link & grant access"')
console.log(`on /portal/brands/${brand.id} when Bacheloneta should be able to log in.`)
