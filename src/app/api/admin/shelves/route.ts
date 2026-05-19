import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// Verify the caller is an admin/staff member.
async function requireAdmin() {
  const { user, response } = await requireAuth()
  if (response) return { response }
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) {
    return { response: err('Forbidden', 403) }
  }
  return { user }
}

// Normalise an incoming shelf payload to the table's columns.
function sanitise(body: any) {
  const mode = body.mode === 'manual' ? 'manual' : 'auto'
  return {
    title:       String(body.title ?? '').trim(),
    subtitle:    String(body.subtitle ?? '').trim(),
    mode,
    auto_filter: ['all', 'open', 'partner', 'featured', 'genre'].includes(body.auto_filter) ? body.auto_filter : 'all',
    auto_genre:  body.auto_genre ? String(body.auto_genre).trim() : null,
    auto_sort:   ['rating', 'popular', 'random'].includes(body.auto_sort) ? body.auto_sort : 'rating',
    place_ids:   Array.isArray(body.place_ids) ? body.place_ids.map(String) : [],
    position:    Number.isFinite(+body.position) ? Math.max(1, Math.round(+body.position)) : 3,
    enabled:     body.enabled !== false,
  }
}

// List every shelf (enabled or not) for the admin UI.
export async function GET() {
  const { response } = await requireAdmin()
  if (response) return response

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('explore_shelves')
    .select('*')
    .order('position', { ascending: true })

  if (error) return err(error.message)
  return ok(data ?? [])
}

// Create a new shelf.
export async function POST(req: Request) {
  const { response } = await requireAdmin()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const row  = sanitise(body)
  if (!row.title) return err('A shelf title is required')

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('explore_shelves')
    .insert(row)
    .select('*')
    .single()

  if (error) return err(error.message)
  return ok(data)
}
