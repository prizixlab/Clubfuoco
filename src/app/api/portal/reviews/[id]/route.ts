import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getChange, applyChange, markReviewed } from '@/lib/pending-changes'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST /api/portal/reviews/:id — { type: 'change'|'night'|'series', decision: 'approve'|'reject' }.
//   change → apply the queued supplier offer change (or discard on reject)
//   night  → publish the promoter night (is_published + approved) / reject it
//   series → approve the recurring series (its occurrences then materialize live)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => null)
  const decision = body?.decision
  const type = body?.type ?? 'change'
  if (decision !== 'approve' && decision !== 'reject') return err('decision must be approve or reject')

  const sb = await createServiceClient()
  const approve = decision === 'approve'

  if (type === 'night' || type === 'series') {
    const table = type === 'night' ? 'promoter_nights' : 'promoter_series'
    const { data: row } = await sb.from(table).select('id, title, review_status').eq('id', id).maybeSingle()
    if (!row) return err('Item not found', 404)
    if ((row as { review_status?: string }).review_status !== 'pending') return err('Already reviewed')

    const patch: Record<string, unknown> = { review_status: approve ? 'approved' : 'rejected' }
    if (type === 'night' && approve) patch.is_published = true
    const { error } = await sb.from(table).update(patch).eq('id', id)
    if (error) return err(error.message, 500)

    const label = type === 'night' ? 'night' : 'series'
    await logAudit(sb, {
      action: `${label}.${decision}`,
      summary: `${approve ? 'Approved' : 'Rejected'} ${label}${(row as { title?: string }).title ? ` “${(row as { title: string }).title}”` : ''}`,
      target_type: label, target_id: id,
    })
    return ok({ [approve ? 'approved' : 'rejected']: true })
  }

  // type === 'change' (supplier offer queue)
  const change = await getChange(sb, id)
  if (!change) return err('Review item not found', 404)
  if (change.status !== 'pending') return err('This item was already reviewed')

  if (approve) {
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
