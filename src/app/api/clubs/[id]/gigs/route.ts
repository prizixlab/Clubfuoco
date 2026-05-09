import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

// GET /api/clubs/[id]/gigs — upcoming confirmed gigs for a club
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('dj_gigs')
    .select(`
      id, event_name, gig_date, start_time, end_time, set_type, is_confirmed,
      dj_profiles (id, stage_name, avatar_url, genres, is_verified, instagram_handle)
    `)
    .eq('club_id', id)
    .eq('is_confirmed', true)
    .gte('gig_date', new Date().toISOString().split('T')[0])
    .order('gig_date', { ascending: true })
    .limit(5)

  if (error) return err(error.message)
  return ok(data)
}
