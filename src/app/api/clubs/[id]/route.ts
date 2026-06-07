import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/clubs/:id
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clubs')
    .select(`
      *,
      live_status (*),
      drink_specials (*)
    `)
    .eq('id', id)
    .single()

  if (error || !data) return err('Club not found', 404)
  // 5min edge cache + 1hr SWR. Venue detail moves slower than the list.
  return ok(data, 200, 'medium')
}
