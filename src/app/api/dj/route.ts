import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

// GET /api/dj — list all DJ profiles (for clubs to browse)
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''
  const supabase = await createServiceClient()

  let query = supabase
    .from('dj_profiles')
    .select('id, stage_name, avatar_url, genres, is_verified, follower_count, bio')
    .order('follower_count', { ascending: false })

  if (q) {
    query = query.ilike('stage_name', `%${q}%`)
  }

  const { data, error } = await query.limit(50)
  if (error) return err(error.message)
  return ok(data)
}
