import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET — DJ views incoming requests, or club views sent requests (?sent=1)
export async function GET(request: NextRequest) {
  const sent = request.nextUrl.searchParams.get('sent') === '1'
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  if (sent) {
    const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
    if (!staff) return err('Not linked to a club')
    const { data, error } = await supabase
      .from('gig_requests')
      .select('*, dj_profiles(id, stage_name, avatar_url, genres)')
      .eq('club_id', staff.club_id)
      .order('created_at', { ascending: false })
    if (error) return err(error.message)
    return ok(data)
  }

  const { data: dj } = await supabase.from('dj_profiles').select('id').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')
  const { data, error } = await supabase
    .from('gig_requests')
    .select('*, clubs(id, name, cover_image_url)')
    .eq('dj_id', dj.id)
    .order('created_at', { ascending: false })
  if (error) return err(error.message)
  return ok(data)
}

// POST — club sends a direct request to a specific DJ
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
  if (!staff) return err('Not linked to a club')

  const { dj_id, event_name, event_date, message, fee_cents, payment_method } = await request.json()
  if (!dj_id || !event_name) return err('DJ and event name required')

  const { data, error } = await supabase
    .from('gig_requests')
    .insert({
      club_id: staff.club_id, dj_id, event_name, event_date, message, status: 'pending',
      fee_cents: fee_cents ?? 0,
      payment_method: payment_method ?? 'off_app',
      payment_status: payment_method === 'off_app' ? 'off_app' : 'unpaid',
    })
    .select()
    .single()
  if (error) return err(error.message)

  // Notify the DJ
  const { data: dj } = await supabase.from('dj_profiles').select('user_id').eq('id', dj_id).single()
  const { data: club } = await supabase.from('clubs').select('name').eq('id', staff.club_id).single()
  if (dj?.user_id) {
    await notify({
      user_id: dj.user_id,
      type: 'gig_request',
      title: `Booking request from ${club?.name}`,
      body: `${club?.name} wants you for "${event_name}"`,
      link: '/dj-dashboard',
    })
  }

  return ok(data, 201)
}
