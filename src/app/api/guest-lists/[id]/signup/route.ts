import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { notify } from '@/lib/notify'

// POST /api/guest-lists/[id]/signup — join guest list (or waitlist if full)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()
  const { full_name, party_size, email, phone, tier } = await request.json()

  // Optionally attach logged-in user
  const anonClient = await createClient()
  const { data: { user } } = await anonClient.auth.getUser()
  const userId = user?.id ?? null

  if (!full_name) return err('Name is required')

  const { data: list, error: listError } = await supabase
    .from('guest_lists')
    .select('id, club_id, capacity, signups_count, is_active, cutoff_time, tier, price_cents')
    .eq('id', id)
    .single()

  if (listError || !list) return err('Guest list not found')
  if (!list.is_active) return err('This guest list is no longer active')

  const size = party_size ?? 1
  const isFull = list.signups_count + size > list.capacity

  if (isFull) {
    // Add to waitlist
    const { data: waitEntry, error: waitError } = await supabase
      .from('guest_list_waitlist')
      .insert({
        guest_list_id: id,
        full_name,
        party_size: size,
        email,
        phone,
        position: list.signups_count + 1,
        status: 'waiting',
      })
      .select()
      .single()

    if (waitError) return err(waitError.message)
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
      tier: tier ?? 'standard',
      user_id: userId,
    })
    .select()
    .single()

  if (error) return err(error.message)

  // Increment count directly in case the DB trigger doesn't fire
  await supabase
    .from('guest_lists')
    .update({ signups_count: list.signups_count + size })
    .eq('id', id)

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
      title: `You're on the list! 🎉`,
      body: `${gl?.event_name} at ${clubName} — arrive before ${list.cutoff_time?.slice(0, 5)}`,
      link: '/bookings',
    })
  }

  return ok({ ...data, waitlisted: false, cutoff_time: list.cutoff_time }, 201)
}

// PATCH /api/guest-lists/[id]/signup — check in a guest (club staff)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()
  const { signup_id, checked_in } = await request.json()

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

  if (error) return err(error.message)
  return ok(data)
}
