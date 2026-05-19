import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

const PAGE = 1000  // PostgREST caps a single response at 1000 rows.

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) return err('Forbidden', 403)

  // Paginate so every club is returned — there are well over 1000, and a single
  // PostgREST query is capped at 1000 rows (which silently dropped clubs
  // alphabetically past "N", e.g. Opium and Pacha, from the venue picker).
  const all: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('clubs')
      .select('id, name, address, rating, is_partner, is_active, google_place_id, last_synced_at')
      .order('name')
      .range(from, from + PAGE - 1)

    if (error) return err(error.message)
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  return ok(all)
}
