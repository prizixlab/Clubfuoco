import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getChange, applyChange, markReviewed } from '@/lib/pending-changes'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST /api/portal/reviews/:id — { decision: 'approve' | 'reject', note? }.
// Approve applies the queued change to the live table then marks it approved;
// reject discards it. Both are logged to the audit trail.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => null)
  const decision = body?.decision
  if (decision !== 'approve' && decision !== 'reject') return err('decision must be approve or reject')

  const sb = await createServiceClient()
  const change = await getChange(sb, id)
  if (!change) return err('Review item not found', 404)
  if (change.status !== 'pending') return err('This item was already reviewed')

  if (decision === 'approve') {
    try {
      await applyChange(sb, change)
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Could not apply the change', 500)
    }
    await markReviewed(sb, id, 'approved')
    await logAudit(sb, { action: 'review.approve', summary: `Approved: ${change.summary}`, target_type: change.entity, target_id: change.target_id ?? undefined, meta: { change_id: id } })
    return ok({ approved: true })
  }

  await markReviewed(sb, id, 'rejected', typeof body?.note === 'string' ? body.note : undefined)
  await logAudit(sb, { action: 'review.reject', summary: `Rejected: ${change.summary}`, target_type: change.entity, target_id: change.target_id ?? undefined, meta: { change_id: id } })
  return ok({ rejected: true })
}
