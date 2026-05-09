import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

// GET /api/clubs
// Query params: genre, open_now, featured, limit
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const genre    = searchParams.get('genre')
  const openNow  = searchParams.get('open_now') === 'true'
  const featured = searchParams.get('featured') === 'true'
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500)
  const offset   = parseInt(searchParams.get('offset') ?? '0')

  let query = supabase
    .from('clubs')
    .select(`
      id, name, slug, description, address, neighborhood,
      lat, lng, cover_image_url, music_genres,
      general_entry_price, vip_table_min_spend,
      instagram_handle, is_featured,
      live_status (
        crowd_percentage, crowd_label, current_dj,
        is_open, queue_wait_minutes, updated_at
      )
    `)
    .eq('is_active', true)
    .order('is_featured', { ascending: false })
    .order('rating', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (genre) query = query.contains('music_genres', [genre])
  if (featured) query = query.eq('is_featured', true)

  const { data, error } = await query
  if (error) return err(error.message)

  // Filter by open_now after fetching (live_status is a join)
  const result = openNow
    ? (data ?? []).filter((c: any) => c.live_status?.is_open)
    : data

  return ok(result)
}
