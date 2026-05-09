import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'

// GET /api/club-dashboard — fetch club manager's dashboard
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()

  // Find clubs this user manages
  const { data: staffRows } = await supabase
    .from('club_staff')
    .select('club_id, role')
    .eq('user_id', user!.id)

  if (!staffRows?.length) return err('No club linked to your account.')

  const clubIds = staffRows.map(s => s.club_id)

  const [clubsRes, guestListsRes, bookingsRes, gigsRes] = await Promise.all([
    supabase.from('clubs').select(`
      id, name, cover_image_url, neighborhood,
      live_status (crowd_percentage, crowd_label, is_open, current_dj, queue_wait_minutes)
    `).in('id', clubIds),

    supabase.from('guest_lists').select(`
      id, event_name, event_date, cutoff_time, capacity, signups_count, is_active, tier, free_entry_label,
      dj_profiles (id, stage_name, avatar_url)
    `).in('club_id', clubIds).order('event_date', { ascending: false }).limit(10),

    supabase.from('bookings').select(`
      id, booking_type, party_size, booking_date, status, total_amount,
      users (full_name, email)
    `).in('club_id', clubIds).order('created_at', { ascending: false }).limit(20),

    supabase.from('dj_gigs').select(`
      id, event_name, gig_date, start_time, set_type, is_confirmed,
      dj_profiles (id, stage_name, avatar_url, instagram_handle)
    `).in('club_id', clubIds).gte('gig_date', new Date().toISOString().split('T')[0]).order('gig_date'),
  ])

  return ok({
    clubs: clubsRes.data ?? [],
    guest_lists: guestListsRes.data ?? [],
    bookings: bookingsRes.data ?? [],
    upcoming_gigs: gigsRes.data ?? [],
    staff_role: staffRows[0].role,
  })
}

// PATCH /api/club-dashboard — update live status
export async function PATCH(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()
  const { club_id, ...updates } = await request.json()

  const { error } = await supabase
    .from('live_status')
    .upsert({ club_id, ...updates }, { onConflict: 'club_id' })

  if (error) return err(error.message)
  return ok({ updated: true })
}
