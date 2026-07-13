import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST /api/portal/promoters/:id — decide a promoter application.
// { decision: 'approve' | 'reject' | 'revoke' }
//   approve → application approved + ig_verified, account gains is_promoter
//             (this is what unlocks the FuocoPromoters app past the lock screen)
//   reject  → application rejected, account keeps/loses is_promoter=false
//   revoke  → pull access from an already-approved promoter (usage control)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => null)
  const decision = body?.decision
  if (!['approve', 'reject', 'revoke'].includes(decision)) {
    return err('decision must be approve, reject, or revoke')
  }

  const sb = await createServiceClient()
  const { data: app } = await sb
    .from('promoter_applications')
    .select('id, user_id, instagram, status')
    .eq('id', id)
    .maybeSingle()
  if (!app) return err('Application not found', 404)
  const a = app as { user_id: string; instagram: string | null; status: string }

  const grant = decision === 'approve'
  const appStatus = grant ? 'approved' : 'rejected'

  const { error: appErr } = await sb
    .from('promoter_applications')
    .update({ status: appStatus, reviewed_at: new Date().toISOString(), ...(grant ? { ig_verified: true } : {}) })
    .eq('id', id)
  if (appErr) return err(appErr.message, 500)

  const { error: userErr } = await sb
    .from('users')
    .update({ is_promoter: grant })
    .eq('id', a.user_id)
  if (userErr) return err(userErr.message, 500)

  const verb = decision === 'approve' ? 'Approved' : decision === 'revoke' ? 'Revoked access for' : 'Rejected'
  await logAudit(sb, {
    action: `promoter.${decision}`,
    summary: `${verb} promoter @${a.instagram ?? a.user_id}`,
    target_type: 'promoter', target_id: a.user_id,
  })
  return ok({ decision, is_promoter: grant })
}
