import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) return err('Forbidden', 403)

  const { data, error } = await supabase
    .from('clubs')
    .select('id, name, address, rating, is_partner, is_active, google_place_id, last_synced_at')
    .order('name')

  if (error) return err(error.message)
  return ok(data ?? [])
}
