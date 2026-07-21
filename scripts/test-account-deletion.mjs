// ─────────────────────────────────────────────────────────────────────────────
// test-account-deletion.mjs — Verifies account deletion works for a user with
// real activity. Creates a throwaway auth user, seeds a booking, a booking
// group (organizer + member row), a membership and a rumbalist purchase, then
// runs the exact sequence /api/account/delete performs and checks every row
// is gone. Cleans up after itself even when deletion fails (pre-migration).
//
// Run:  node --env-file=.env.local scripts/test-account-deletion.mjs
//
// Expected before supabase/migrations/20260704_account_deletion_cascades.sql
// is applied: FAIL with a foreign-key violation. Expected after: PASS.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const today = new Date().toISOString().slice(0, 10)

let uid = null
const seeded = { bookings: [], booking_groups: [], booking_group_members: [], memberships: [], rumbalist_purchases: [] }

async function seed() {
  const email = `account-delete-test-${Date.now()}@example.com`
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: randomBytes(16).toString('hex'),
    email_confirm: true,
  })
  if (createErr) throw new Error(`createUser: ${createErr.message}`)
  uid = created.user.id
  console.log(`Created throwaway user ${email} (${uid})`)

  // Profile row is normally created by the on_auth_user_created trigger.
  const { data: profile } = await supabase.from('users').select('id').eq('id', uid).maybeSingle()
  if (!profile) {
    const { error } = await supabase.from('users').insert({ id: uid, email })
    if (error) throw new Error(`users insert: ${error.message}`)
  }

  const { data: club, error: clubErr } = await supabase.from('clubs').select('id').limit(1).single()
  if (clubErr) throw new Error(`need at least one club: ${clubErr.message}`)

  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .insert({ user_id: uid, club_id: club.id, booking_type: 'general', party_size: 2, booking_date: today, status: 'confirmed' })
    .select('id').single()
  if (bookingErr) throw new Error(`bookings insert: ${bookingErr.message}`)
  seeded.bookings.push(booking.id)

  const { data: group, error: groupErr } = await supabase
    .from('booking_groups')
    .insert({ club_id: club.id, organizer_id: uid, booking_type: 'general', booking_date: today, invite_code: randomBytes(8).toString('hex') })
    .select('id').single()
  if (groupErr) throw new Error(`booking_groups insert: ${groupErr.message}`)
  seeded.booking_groups.push(group.id)

  const { data: member, error: memberErr } = await supabase
    .from('booking_group_members')
    .insert({ group_id: group.id, user_id: uid, role: 'organizer', rsvp: 'going', booking_id: booking.id })
    .select('id').single()
  if (memberErr) throw new Error(`booking_group_members insert: ${memberErr.message}`)
  seeded.booking_group_members.push(member.id)

  const { data: membership, error: membershipErr } = await supabase
    .from('memberships')
    .insert({ user_id: uid, tier: 'gold', status: 'active' })
    .select('id').single()
  if (membershipErr) throw new Error(`memberships insert: ${membershipErr.message}`)
  seeded.memberships.push(membership.id)

  const { data: purchase, error: purchaseErr } = await supabase
    .from('rumbalist_purchases')
    .insert({
      user_id: uid, venue_id: 'test-venue', venue_name: 'Test Venue',
      product_name: 'Free Guestlist', product_kind: 'free_guestlist',
      price_eur: 0, event_date: today, booking_id: booking.id,
    })
    .select('id').single()
  if (purchaseErr) throw new Error(`rumbalist_purchases insert: ${purchaseErr.message}`)
  seeded.rumbalist_purchases.push(purchase.id)

  console.log('Seeded: booking, booking_group + member row, membership, rumbalist purchase')
}

// The exact sequence src/app/api/account/delete/route.ts performs.
async function deleteLikeTheRoute() {
  const { error: profileErr } = await supabase.from('users').delete().eq('id', uid)
  if (profileErr) console.log(`  users delete failed (route ignores this): ${profileErr.message}`)
  const { error } = await supabase.auth.admin.deleteUser(uid)
  if (error) throw new Error(`auth deleteUser: ${error.message}`)
}

async function verifyGone() {
  const problems = []
  for (const [table, ids] of Object.entries(seeded)) {
    if (!ids.length) continue
    const { data, error } = await supabase.from(table).select('id').in('id', ids)
    if (error) problems.push(`${table}: ${error.message}`)
    else if (data.length) problems.push(`${table}: ${data.length} row(s) survived`)
  }
  const { data: profile } = await supabase.from('users').select('id').eq('id', uid).maybeSingle()
  if (profile) problems.push('users: profile row survived')
  const { data: authUser } = await supabase.auth.admin.getUserById(uid)
  if (authUser?.user) problems.push('auth.users: auth user survived')
  return problems
}

// Manual removal in dependency order — works even without the cascades,
// so a failed run never leaves junk in production.
async function cleanup() {
  if (!uid) return
  await supabase.from('booking_group_members').delete().eq('user_id', uid)
  await supabase.from('booking_groups').delete().eq('organizer_id', uid)
  await supabase.from('rumbalist_purchases').delete().eq('user_id', uid)
  await supabase.from('bookings').delete().eq('user_id', uid)
  await supabase.from('memberships').delete().eq('user_id', uid)
  await supabase.from('users').delete().eq('id', uid)
  await supabase.auth.admin.deleteUser(uid).catch(() => {})
}

try {
  await seed()
  console.log('Running the /api/account/delete sequence…')
  await deleteLikeTheRoute()
  const problems = await verifyGone()
  if (problems.length) {
    console.error('\nFAIL — deletion ran but left rows behind:')
    for (const p of problems) console.error(`  ✗ ${p}`)
    process.exitCode = 1
  } else {
    console.log('\nPASS — user and every dependent row deleted cleanly.')
  }
} catch (err) {
  console.error(`\nFAIL — ${err.message}`)
  console.error('(Expected if 20260704_account_deletion_cascades.sql has not been applied yet.)')
  process.exitCode = 1
} finally {
  await cleanup()
  console.log('Cleanup done — no test rows left behind.')
}
