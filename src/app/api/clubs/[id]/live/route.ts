import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/clubs/:id/live
// Polled every 60 seconds on the club detail screen
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('live_status')
    .select('*')
    .eq('club_id', id)
    .single()

  if (error || !data) return err('Live status not found', 404)
  return ok(data)
}
