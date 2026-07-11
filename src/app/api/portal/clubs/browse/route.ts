import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/clubs/browse — paginated, searchable club list for the Clubs
// tab. Returns { clubs, total }. Separate from the base /api/portal/clubs
// (which stays an active id+name array the offers picker depends on), because
// this one spans all 1600+ clubs (active + inactive) and must page.
const SUMMARY = 'id, name, neighborhood, address, cover_image_url, is_active, is_partner, is_featured, rating'

export async function GET(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const { searchParams } = new URL(request.url)
  // PostgREST .or() is comma/paren-delimited — strip those from user input so a
  // search like "bar, club" can't break the filter syntax.
  const q      = (searchParams.get('q') ?? '').trim().replace(/[(),]/g, ' ').trim()
  const limit  = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '30', 10) || 30, 1), 100)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)
  const scope  = searchParams.get('scope')   // 'active' | 'partner' | null (all)

  let query = sb.from('clubs').select(SUMMARY, { count: 'exact' })
  if (q) query = query.or(`name.ilike.%${q}%,neighborhood.ilike.%${q}%,address.ilike.%${q}%`)
  if (scope === 'active')  query = query.eq('is_active', true)
  if (scope === 'partner') query = query.eq('is_partner', true)
  query = query
    .order('is_active', { ascending: false })
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) return err(error.message, 500)
  return ok({ clubs: data ?? [], total: count ?? 0 })
}
