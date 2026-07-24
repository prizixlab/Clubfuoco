import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { getBoolSetting, setBoolSetting, AUTO_APPROVE } from '@/lib/app-settings'
import { approveAllPending } from '@/lib/pending-changes'
import { ok, err } from '@/lib/utils'

// GET  /api/portal/settings — portal-level toggles.
// PUT  /api/portal/settings — { auto_approve: boolean }.
//   Turning auto-approve ON also clears whatever is already in the queue, so
//   "on" means nothing is waiting — present or future.

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  return ok({ auto_approve: await getBoolSetting(sb, AUTO_APPROVE) })
}

const Body = z.object({ auto_approve: z.boolean() }).strict()

export async function PUT(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('auto_approve (boolean) required')
  const { auto_approve } = parsed.data

  const sb = await createServiceClient()
  try {
    await setBoolSetting(sb, AUTO_APPROVE, auto_approve)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not save'
    if (/app_settings|schema cache|does not exist|relation/i.test(msg)) {
      return err('Auto-approve needs a schema change that has not been applied yet — run ' +
                 'supabase/migrations/20260723_auto_approve.sql in the SQL editor.', 503)
    }
    return err(msg)
  }

  // Clear the current queue on enable so nothing is left hanging.
  const swept = auto_approve ? await approveAllPending(sb) : { changes: 0, nights: 0, series: 0 }
  const total = swept.changes + swept.nights + swept.series

  await logAudit(sb, {
    action: 'settings.auto_approve',
    summary: auto_approve
      ? `Auto-approve turned ON${total ? ` — cleared ${total} pending item${total === 1 ? '' : 's'}` : ''}`
      : 'Auto-approve turned OFF',
    target_type: 'setting', target_id: AUTO_APPROVE, meta: { auto_approve, swept },
  })

  return ok({ auto_approve, swept })
}
