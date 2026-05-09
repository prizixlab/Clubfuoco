import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('dj_profiles')
    .select(`
      id, stage_name, bio, avatar_url, genres,
      soundcloud_url, mixcloud_url, spotify_url,
      instagram_handle, is_verified, follower_count, created_at,
      users (full_name, email),
      dj_gigs (
        id, event_name, gig_date, start_time, set_type, is_confirmed,
        clubs (id, name, cover_image_url, neighborhood)
      )
    `)
    .eq('id', id)
    .single()

  if (error) return err(error.message)
  return ok(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from('dj_profiles')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data)
}
