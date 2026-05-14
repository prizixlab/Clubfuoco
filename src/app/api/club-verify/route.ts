import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { generateVerificationPhrase } from '@/lib/verificationPhrase'

// GET — check current user's pending request status
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data } = await supabase
    .from('club_verification_requests')
    .select('*, clubs(id, name, instagram_handle)')
    .eq('user_id', user!.id)
    .single()

  return ok(data ?? null)
}

// POST — submit a new verification request
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  // One pending request per user
  const { data: existing } = await supabase
    .from('club_verification_requests')
    .select('id, status')
    .eq('user_id', user!.id)
    .single()

  if (existing && existing.status !== 'rejected') {
    return err('You already have a pending verification request')
  }

  // If rejected, delete it so they can resubmit
  if (existing?.status === 'rejected') {
    await supabase.from('club_verification_requests').delete().eq('user_id', user!.id)
  }

  const body = await request.json()
  const { type, club_id, club_name, instagram_handle, address, city, google_maps_url, website_url, eventbrite_organizer_id } = body

  if (!instagram_handle) return err('Instagram handle is required')
  if (type === 'new' && !club_name) return err('Club name is required')
  if (type === 'new' && !address) return err('Address is required')
  if (type === 'claim' && !club_id) return err('Select a club to claim')

  // Normalise handle (strip @ and spaces)
  const handle = instagram_handle.replace(/^@/, '').trim().toLowerCase()

  const insert: Record<string, any> = {
    user_id: user!.id,
    instagram_handle: handle,
    verification_code: generateVerificationPhrase(),
    eventbrite_organizer_id: eventbrite_organizer_id?.trim() || null,
  }

  if (type === 'claim') {
    insert.club_id = club_id
    // Pull club name for the record
    const { data: club } = await supabase.from('clubs').select('name').eq('id', club_id).single()
    insert.club_name = club?.name
  } else {
    insert.club_name = club_name
    insert.address = address
    insert.city = city ?? null
    insert.google_maps_url = google_maps_url ?? null
    insert.website_url = website_url ?? null
    // If maps URL provided immediately, skip that step
    if (google_maps_url) insert.status = 'pending_instagram'
  }

  const { data, error } = await supabase
    .from('club_verification_requests')
    .insert(insert)
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}

// PATCH — user adds/updates their Google Maps URL after submission
export async function PATCH(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { google_maps_url } = await request.json()
  if (!google_maps_url) return err('Google Maps URL required')

  const { data, error } = await supabase
    .from('club_verification_requests')
    .update({ google_maps_url, status: 'pending_instagram' })
    .eq('user_id', user!.id)
    .eq('status', 'pending_maps')
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data)
}

// DELETE — withdraw pending request (only while pending_instagram)
export async function DELETE() {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  await supabase
    .from('club_verification_requests')
    .delete()
    .eq('user_id', user!.id)
    .in('status', ['pending_instagram', 'pending_maps'])

  return ok(null)
}
