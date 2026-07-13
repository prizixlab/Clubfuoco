import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { listPending } from '@/lib/pending-changes'
import { ok, err } from '@/lib/utils'

// GET /api/portal/reviews — the approval queue: everything pushed from the
// promoter app that's waiting for staff approval before going live.
export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  try {
    const rows = await listPending(sb)
    return ok(rows.map(r => ({
      id: r.id, source: r.source, entity: r.entity, action: r.action,
      summary: r.summary, created_at: r.created_at, payload: r.payload,
    })))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not load reviews', 500)
  }
}
