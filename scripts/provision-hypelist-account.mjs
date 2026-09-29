// ─────────────────────────────────────────────────────────────────────────────
// provision-hypelist-account.mjs — create the HypeList promoter account and
// link it to their brand.
//
//   node --env-file=.env.local scripts/provision-hypelist-account.mjs          # dry run
//   node --env-file=.env.local scripts/provision-hypelist-account.mjs --apply
//
// Deliberately does NOT email anyone. The portal route
// (/api/portal/brands/:id/provision-login) generates a Supabase invite link
// and sends it through Resend; that is the right button to press when HypeList
// should actually log in. This script only stands the account up so that
// promoter-owned rows — chiefly promoter_nights.created_by, which is a real
// auth uid — have an owner to point at.
//
// email_confirm: true so Supabase does not send its own confirmation mail
// either. No password is set: they get one from the portal's password link.
//
// Idempotent: an existing account for the address is reused, and the brand
// link is only written when it is missing or points somewhere else.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env. Run with --env-file=.env.local')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

const EMAIL      = 'hypelist@clubfuoco.com'
const FULL_NAME  = 'HypeList'
const BRAND_KEY  = 'hypelist'

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const { data: brand } = await sb.from('partner_brands').select('*').eq('key', BRAND_KEY).maybeSingle()
if (!brand) {
  console.error(`! no brand with key "${BRAND_KEY}" — run scripts/import-hypelist.mjs --apply first`)
  process.exit(1)
}
console.log(`brand  ${brand.name}  ${brand.id}  owner=${brand.owner_user_id ?? 'none'}`)

// ── Find or create the auth account ──────────────────────────────────────────
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
    user_metadata: { full_name: FULL_NAME },
  })
  if (error) { console.error('! createUser:', error.message); process.exit(1) }
  uid = data.user.id
  console.log(`auth   created ${uid}`)
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  process.exit(0)
}

// ── Mark it a promoter ───────────────────────────────────────────────────────
// A trigger may already have inserted the users row on auth creation; upsert
// so this works whether or not it did.
const { error: uErr } = await sb.from('users')
  .upsert({ id: uid, email: EMAIL, full_name: FULL_NAME, account_kind: 'promoter', is_promoter: true },
          { onConflict: 'id' })
if (uErr) { console.error('! users upsert:', uErr.message); process.exit(1) }
console.log(`users  ${uid} → account_kind=promoter, is_promoter=true`)

// ── Link the brand ───────────────────────────────────────────────────────────
// One login owns exactly one brand (getBrandByOwner uses .maybeSingle()), so
// refuse rather than create a second.
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
console.log('on /portal/brands/' + brand.id + ' when HypeList should be able to log in.')
