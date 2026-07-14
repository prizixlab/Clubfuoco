import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getChange, applyChange, markReviewed } from '@/lib/pending-changes'
import { logAudit } from '@/lib/portal-audit'
import { notify } from '@/lib/notify'
import { sendPushToUser } from '@/lib/push'
import { ok, err } from '@/lib/utils'

// POST /api/portal/reviews/:id — { type: 'change'|'night'|'series', decision: 'approve'|'reject', reason? }.
//   change → apply the queued supplier offer change (or discard on reject)
//   night  → publish the promoter night (is_published + approved) / reject it
//   series → approve the recurring series (its occurrences then materialize live)
// On reject, `reason` (or legacy `note`) is stored — rejection_reason on
// nights/series, note on pending_changes — and threaded back to the submitter.
// Every night/series outcome notifies the promoter (in-app row + APNs push).

type SB = Awaited<ReturnType<typeof createServiceClient>>

// Owner of a night = the promoter allocated to it; series carry promoter_id.
async function promoterUserId(sb: SB, type: 'night' | 'series', id: string): Promise<string | null> {
  if (type === 'series') {
    const { data } = await sb.from('promoter_series').select('promoter_id').eq('id', id).maybeSingle()
    return (data as { promoter_id?: string } | null)?.promoter_id ?? null
  }
  const { data } = await sb
    .from('promoter_allocations')
    .select('promoter_id')
    .eq('night_id', id)
    .limit(1)
    .maybeSingle()
  return (data as { promoter_id?: string } | null)?.promoter_id ?? null
}

async function notifyReviewOutcome(
  sb: SB,
  opts: { userId: string; entity: 'night' | 'series' | 'offer'; entityId: string; approved: boolean; title?: string | null; reason?: string },
) {
  const label = opts.entity === 'offer' ? 'offer change' : opts.entity
  const name = opts.title ? ` “${opts.title}”` : ''
  const title = opts.approved ? 'Approved and live' : 'Changes needed'
  const body = opts.approved
    ? `Your ${label}${name} was approved.`
    : `Your ${label}${name} was rejected${opts.reason ? `: ${opts.reason}` : '.'}`
  await notify({ user_id: opts.userId, type: 'review_outcome', title, body })
  await sendPushToUser(sb, opts.userId, {
    title, body,
    payload: {
      type: 'review_outcome',
      entity: opts.entity,
      id: opts.entityId,
      decision: opts.approved ? 'approved' : 'rejected',
      ...(opts.reason ? { reason: opts.reason } : {}),
    },
  })
}
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

  const reason = typeof body?.reason === 'string' && body.reason.trim()
    ? body.reason.trim()
    : typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : undefined

  if (type === 'night' || type === 'series') {
    const table = type === 'night' ? 'promoter_nights' : 'promoter_series'
    const { data: row } = await sb.from(table).select('id, title, review_status').eq('id', id).maybeSingle()
    if (!row) return err('Item not found', 404)
    if ((row as { review_status?: string }).review_status !== 'pending') return err('Already reviewed')

    const patch: Record<string, unknown> = {
      review_status: approve ? 'approved' : 'rejected',
      rejection_reason: approve ? null : reason ?? null,
    }
    if (type === 'night' && approve) patch.is_published = true
    let { error } = await sb.from(table).update(patch).eq('id', id)
    if (error && /rejection_reason|column|schema cache/i.test(error.message)) {
      // Drift-defensive: rejection_reason migration not applied yet — the
      // decision itself must still land.
      delete patch.rejection_reason
      ;({ error } = await sb.from(table).update(patch).eq('id', id))
    }
    if (error) return err(error.message, 500)

    const label = type === 'night' ? 'night' : 'series'
    await logAudit(sb, {
      action: `${label}.${decision}`,
      summary: `${approve ? 'Approved' : 'Rejected'} ${label}${(row as { title?: string }).title ? ` “${(row as { title: string }).title}”` : ''}${!approve && reason ? ` — ${reason}` : ''}`,
      target_type: label, target_id: id,
    })

    const owner = await promoterUserId(sb, type, id)
    if (owner) {
      await notifyReviewOutcome(sb, {
        userId: owner, entity: type, entityId: id, approved: approve,
        title: (row as { title?: string | null }).title, reason,
      })
    }
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
    if (change.submitter_user_id) {
      await notifyReviewOutcome(sb, {
        userId: change.submitter_user_id, entity: 'offer', entityId: id,
        approved: true, title: change.summary,
      })
    }
    return ok({ approved: true })
  }

  await markReviewed(sb, id, 'rejected', reason)
  await logAudit(sb, { action: 'review.reject', summary: `Rejected: ${change.summary}`, target_type: change.entity, target_id: change.target_id ?? undefined, meta: { change_id: id } })
  if (change.submitter_user_id) {
    await notifyReviewOutcome(sb, {
      userId: change.submitter_user_id, entity: 'offer', entityId: id,
      approved: false, title: change.summary, reason,
    })
  }
  return ok({ rejected: true })
}
