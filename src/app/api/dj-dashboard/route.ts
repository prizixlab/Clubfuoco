import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// GET /api/dj-dashboard — fetch the logged-in DJ's full dashboard data
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()

  const { data: profile, error } = await supabase
    .from('dj_profiles')
    .select(`
      id, stage_name, bio, avatar_url, genres,
      soundcloud_url, mixcloud_url, spotify_url,
      instagram_handle, is_verified, follower_count,
      dj_gigs (
        id, event_name, gig_date, start_time, end_time, set_type, is_confirmed,
        clubs (id, name, cover_image_url, neighborhood),
        guest_lists (id, event_name, is_active, capacity, signups_count)
      )
    `)
    .eq('user_id', user!.id)
    .single()

  if (error) return err('DJ profile not found. Please complete your profile first.')
  return ok(profile)
}

// POST /api/dj-dashboard — create DJ profile
export async function POST(request: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()
  const body = await request.json()

  // Update account type
  await supabase.from('users').update({ account_type: 'dj' }).eq('id', user!.id)

  const { data, error } = await supabase
    .from('dj_profiles')
    .upsert({ user_id: user!.id, ...body }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}
