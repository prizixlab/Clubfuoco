import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

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

function sanitise(body: any) {
  const out: Record<string, any> = {}
  if (body.title       !== undefined) out.title       = String(body.title).trim()
  if (body.subtitle    !== undefined) out.subtitle    = String(body.subtitle).trim()
  if (body.mode        !== undefined) out.mode        = body.mode === 'manual' ? 'manual' : 'auto'
  if (body.auto_filter !== undefined) out.auto_filter = ['all', 'open', 'partner', 'featured', 'genre'].includes(body.auto_filter) ? body.auto_filter : 'all'
  if (body.auto_genre  !== undefined) out.auto_genre  = body.auto_genre ? String(body.auto_genre).trim() : null
  if (body.auto_sort   !== undefined) out.auto_sort   = ['rating', 'popular', 'random'].includes(body.auto_sort) ? body.auto_sort : 'rating'
  if (body.place_ids   !== undefined) out.place_ids   = Array.isArray(body.place_ids) ? body.place_ids.map(String) : []
  if (body.position    !== undefined) out.position    = Number.isFinite(+body.position) ? Math.max(1, Math.round(+body.position)) : 3
  if (body.enabled     !== undefined) out.enabled     = !!body.enabled
  out.updated_at = new Date().toISOString()
  return out
}

// Update a shelf.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdmin()
  if (response) return response

  const { id } = await params
  const body   = await req.json().catch(() => ({}))
  const patch  = sanitise(body)

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('explore_shelves')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return err(error.message)
  return ok(data)
}

// Delete a shelf.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdmin()
  if (response) return response

  const { id } = await params
  const supabase = await createServiceClient()
  const { error } = await supabase.from('explore_shelves').delete().eq('id', id)

  if (error) return err(error.message)
  return ok({ deleted: true })
}
