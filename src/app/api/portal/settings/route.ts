import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { getBoolSetting, setBoolSetting, AUTO_APPROVE, AUTO_APPROVE_PROMOTERS } from '@/lib/app-settings'
import { approveAllPending } from '@/lib/pending-changes'
import { approveAllPendingPromoters } from '@/lib/promoter-approval'
import { ok, err } from '@/lib/utils'

// GET  /api/portal/settings — portal-level toggles.
// PUT  /api/portal/settings — { auto_approve?: boolean, auto_approve_promoters?: boolean }
//   Send either or both; whatever is present is what changes.
//   Turning a toggle ON also clears whatever is already in its queue, so "on"
//   means nothing is waiting — present or future.
//
//   The two are separate doors on purpose: auto_approve waves through what an
//   already-trusted promoter publishes, auto_approve_promoters decides who
//   becomes a promoter at all.

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  const [auto_approve, auto_approve_promoters] = await Promise.all([
    getBoolSetting(sb, AUTO_APPROVE),
    getBoolSetting(sb, AUTO_APPROVE_PROMOTERS),
  ])
  return ok({ auto_approve, auto_approve_promoters })
}

const Body = z.object({
  auto_approve:           z.boolean().optional(),
  auto_approve_promoters: z.boolean().optional(),
}).strict().refine(
  b => b.auto_approve !== undefined || b.auto_approve_promoters !== undefined,
  'nothing to set',
)

export async function PUT(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('auto_approve and/or auto_approve_promoters (boolean) required')
  const { auto_approve, auto_approve_promoters } = parsed.data

  const sb = await createServiceClient()
  try {
    if (auto_approve !== undefined) await setBoolSetting(sb, AUTO_APPROVE, auto_approve)
    if (auto_approve_promoters !== undefined) await setBoolSetting(sb, AUTO_APPROVE_PROMOTERS, auto_approve_promoters)
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
  const sweptPromoters = auto_approve_promoters ? await approveAllPendingPromoters(sb) : 0

  if (auto_approve !== undefined) {
    await logAudit(sb, {
      action: 'settings.auto_approve',
      summary: auto_approve
        ? `Auto-approve turned ON${total ? ` — cleared ${total} pending item${total === 1 ? '' : 's'}` : ''}`
        : 'Auto-approve turned OFF',
      target_type: 'setting', target_id: AUTO_APPROVE, meta: { auto_approve, swept },
    })
  }
  if (auto_approve_promoters !== undefined) {
    await logAudit(sb, {
      action: 'settings.auto_approve_promoters',
      summary: auto_approve_promoters
        ? `New-promoter auto-approve turned ON${sweptPromoters ? ` — approved ${sweptPromoters} waiting application${sweptPromoters === 1 ? '' : 's'}` : ''}`
        : 'New-promoter auto-approve turned OFF',
      target_type: 'setting', target_id: AUTO_APPROVE_PROMOTERS,
      meta: { auto_approve_promoters, approved: sweptPromoters },
    })
  }

  const [nowAuto, nowPromoters] = await Promise.all([
    auto_approve !== undefined ? Promise.resolve(auto_approve) : getBoolSetting(sb, AUTO_APPROVE),
    auto_approve_promoters !== undefined ? Promise.resolve(auto_approve_promoters) : getBoolSetting(sb, AUTO_APPROVE_PROMOTERS),
  ])

  return ok({
    auto_approve: nowAuto,
    auto_approve_promoters: nowPromoters,
    swept,
    swept_promoters: sweptPromoters,
  })
}
