import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/utils'
import { getUser } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { requireListStaff } from '@/lib/guest-lists'
import { rateLimit, clientIp } from '@/lib/ratelimit'

// Public on purpose (a guest can sign up without an account), so everything in
// the body is untrusted: a negative party size used to lower signups_count and
// reopen a full list, and the client picked its own tier.
const signupSchema = z.object({
  full_name:  z.string().trim().min(1, 'Name is required').max(100),
  party_size: z.number().int().min(1).max(10).default(1),
  email:      z.string().trim().email().max(200).optional().or(z.literal('').transform(() => undefined)),
  phone:      z.string().trim().max(30).optional(),
  tier:       z.enum(['standard', 'vip']).default('standard'),
})

// POST /api/guest-lists/[id]/signup — join guest list (or waitlist if full)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()
  const parsed = signupSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid signup')
  const { full_name, party_size: size, email, phone, tier } = parsed.data

  // Optionally attach the signed-in user (cookie on web, Bearer on native).
  const user = await getUser()
  const userId = user?.id ?? null
  if (!rateLimit(`gl-signup:${userId ?? clientIp(request)}`, 10, 10 * 60_000)) {
    return err('Too many attempts. Wait a few minutes and try again.', 429)
  }

  const { data: list, error: listError } = await supabase
    .from('guest_lists')
    .select('id, club_id, capacity, signups_count, is_active, cutoff_time, tier, price_cents')
    .eq('id', id)
    .single()

  if (listError || !list) return err('Guest list not found')
  if (!list.is_active) return err('This guest list is no longer active')

  // VIP is only on lists that offer it, and a priced VIP spot needs a payment
  // this route has never taken — refuse it rather than hand it out free.
  if (tier === 'vip') {
    if ((list.price_cents ?? 0) > 0) return err('Paid VIP entry isn’t available here yet.', 409)
    if (list.tier !== 'vip') return err('This list has no VIP tier.', 400)
  }

  const isFull = list.signups_count + size > list.capacity

  if (isFull) {
    // Place in the queue = people already waiting + 1.
    const { count: waiting } = await supabase
      .from('guest_list_waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('guest_list_id', id).eq('status', 'waiting')
    const { data: waitEntry, error: waitError } = await supabase
      .from('guest_list_waitlist')
      .insert({
        guest_list_id: id,
        full_name,
        party_size: size,
        email,
        phone,
        position: (waiting ?? 0) + 1,
        status: 'waiting',
      })
      .select()
      .single()

    if (waitError) return err('Couldn’t add you to the waitlist', 500)
    return ok({ ...waitEntry, waitlisted: true, cutoff_time: list.cutoff_time }, 201)
  }

  const { data, error } = await supabase
    .from('guest_list_signups')
    .insert({
      guest_list_id: id,
      club_id: list.club_id,
      full_name,
      party_size: size,
      email,
      phone,
      tier,
      user_id: userId,
    })
    .select()
    .single()

  if (error) return err('Couldn’t add you to the list', 500)

  // The on_signup trigger (002_guest_lists.sql) adds party_size to the count.
  // Production drifts from the migrations folder, so it may not be there —
  // bump the count by hand ONLY if the trigger didn't. Bumping it always
  // counted every signup twice wherever the trigger does exist.
  const { data: after } = await supabase
    .from('guest_lists').select('signups_count').eq('id', id).single()
  if (after && after.signups_count === list.signups_count) {
    await supabase
      .from('guest_lists')
      .update({ signups_count: list.signups_count + size })
      .eq('id', id)
  }

  // Notify the user
  if (userId) {
    const { data: gl } = await supabase
      .from('guest_lists')
      .select('event_name, clubs(name)')
      .eq('id', id)
      .single()
    const clubName = (gl as any)?.clubs?.name ?? 'the club'
    await notify({
      user_id: userId,
      type: 'guestlist_confirmed',
      title: `You're on the list!`,
      body: `${gl?.event_name} at ${clubName} — arrive before ${list.cutoff_time?.slice(0, 5)}`,
      link: '/bookings',
    })
  }

  return ok({ ...data, waitlisted: false, cutoff_time: list.cutoff_time }, 201)
}

// PATCH /api/guest-lists/[id]/signup — check in a guest (the club's staff only)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()
  // This had no auth at all: anyone could check any guest in or out.
  const { response } = await requireListStaff(supabase, id)
  if (response) return response
  const { signup_id, checked_in } = await request.json().catch(() => ({}))
  if (typeof signup_id !== 'string' || typeof checked_in !== 'boolean') {
    return err('signup_id and checked_in are required')
  }

  const { data, error } = await supabase
    .from('guest_list_signups')
    .update({
      checked_in,
      checked_in_at: checked_in ? new Date().toISOString() : null,
    })
    .eq('id', signup_id)
    .eq('guest_list_id', id)
    .select()
    .single()

  if (error) return err('Signup not found', 404)
  return ok(data)
}
