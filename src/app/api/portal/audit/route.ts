import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { listAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// GET /api/portal/audit — recent operator actions for the Activity tab.
export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  try {
    return ok(await listAudit(sb, 150))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not load activity', 500)
  }
}
