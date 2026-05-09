import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// GET /api/staff/rumbas — staff/admin only — all rumbas with signup counts
export async function GET() {
  const { response } = await requireRole(['staff', 'admin'])
  if (response) return response

  const supabase = await createServiceClient()

  const { data: rumbas, error } = await supabase
    .from('rumbas')
    .select('*')
    .order('event_date', { ascending: false })

  if (error) return err(error.message, 500)

  const rumbaIds = (rumbas ?? []).map((r: any) => r.id)
  let countMap: Record<string, number> = {}

  if (rumbaIds.length > 0) {
    const { data: counts } = await supabase
      .from('rumba_signups')
      .select('rumba_id')
      .in('rumba_id', rumbaIds)
      .neq('status', 'denied')

    if (counts) {
      counts.forEach((c: any) => {
        countMap[c.rumba_id] = (countMap[c.rumba_id] ?? 0) + 1
      })
    }
  }

  const withCounts = (rumbas ?? []).map((r: any) => ({
    ...r,
    signup_count: countMap[r.id] ?? 0,
  }))

  return ok(withCounts)
}
