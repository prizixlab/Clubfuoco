import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// Enabled custom Explore shelves, ordered for insertion among the default rows.
export async function GET() {
  const { response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('explore_shelves')
    .select('id, title, subtitle, mode, auto_filter, auto_genre, auto_sort, place_ids, position')
    .eq('enabled', true)
    .order('position', { ascending: true })

  if (error) return err(error.message)
  return ok(data ?? [])
}
