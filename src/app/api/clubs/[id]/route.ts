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
    .eq('is_active', true)
    .single()

  if (error || !data) return err('Club not found', 404)
  return ok(data)
}
