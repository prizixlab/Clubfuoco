import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/clubs/:id/specials — active specials only
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('drink_specials')
    .select('*')
    .eq('club_id', id)
    .eq('is_active', true)
    .or(`valid_until.is.null,valid_until.gte.${now}`)
    .order('created_at', { ascending: false })

  if (error) return err(error.message)
  return ok(data)
}
