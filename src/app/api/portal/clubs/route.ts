import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/clubs — id + name for the offers editor's club picker.
export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  const { data, error } = await sb
    .from('clubs')
    .select('id, name')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) return err(error.message, 500)
  return ok(data ?? [])
}
