import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { provisionBrandForUser } from '@/lib/offer-auth'
import { getBrandByOwner } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// Instagram handles: letters, numbers, dots, underscores; 30 max. Stored bare
// (no leading @) — the UI adds it back.
const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/
const normalizeHandle = (s: string) => s.trim().replace(/^@+/, '').trim()

// PATCH /api/portal/promoters/:id — Instagram verification + adjustment.
// { instagram?: string, ig_verified?: boolean }
//
// Verification is its own step, deliberately separate from approval: staff
// confirm the DM'd code came from the claimed account, THEN decide on access.
// Adjustment fixes a handle the applicant typo'd (or DM'd from a different
// account) without making them re-apply — changing the handle clears
// ig_verified, because the code was proved against the OLD account.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('Bad request')

  const sb = await createServiceClient()
  const { data: app } = await sb
    .from('promoter_applications')
    .select('id, user_id, instagram, ig_verified')
    .eq('id', id)
    .maybeSingle()
  if (!app) return err('Application not found', 404)
  const a = app as { user_id: string; instagram: string | null; ig_verified: boolean | null }

  const patch: Record<string, unknown> = {}
  const notes: string[] = []

  if (typeof body.instagram === 'string') {
    const handle = normalizeHandle(body.instagram)
    if (!IG_HANDLE.test(handle)) return err('Not a valid Instagram handle')
    if (handle !== (a.instagram ?? '')) {
      patch.instagram = handle
      notes.push(`handle @${a.instagram ?? '—'} → @${handle}`)
      // The code was proved against the previous account — re-verify.
      if (a.ig_verified) {
        patch.ig_verified = false
        notes.push('verification reset')
      }
    }
  }

  // An explicit ig_verified in the body wins over the reset above.
  if (typeof body.ig_verified === 'boolean' && body.ig_verified !== a.ig_verified) {
    patch.ig_verified = body.ig_verified
    notes.push(body.ig_verified ? 'Instagram verified' : 'Instagram unverified')
  }

  if (!Object.keys(patch).length) return ok({ unchanged: true })

  const { error } = await sb.from('promoter_applications').update(patch).eq('id', id)
  if (error) return err(error.message, 500)

  await logAudit(sb, {
    action: 'promoter.instagram',
    summary: `@${(patch.instagram as string) ?? a.instagram ?? a.user_id}: ${notes.join(', ')}`,
    target_type: 'promoter', target_id: a.user_id,
  })
  return ok({ updated: true, ...patch })
}

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

  // Approval provisions the promoter's brand (their list) right away — a
  // promoter and their brand are one entity, so there's no "approved but no
  // brand yet" state. Idempotent, so re-approving after a revoke is a no-op.
  // Revoke pulls app access only: the brand + its offers stay independent.
  let brandCreated = false
  if (grant) {
    try {
      const before = await getBrandByOwner(sb, a.user_id)
      await provisionBrandForUser(sb, a.user_id)
      brandCreated = !before
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Could not provision brand', 500)
    }
  }

  const verb = decision === 'approve' ? 'Approved' : decision === 'revoke' ? 'Revoked access for' : 'Rejected'
  await logAudit(sb, {
    action: `promoter.${decision}`,
    summary: `${verb} promoter @${a.instagram ?? a.user_id}${brandCreated ? ' (brand provisioned)' : ''}`,
    target_type: 'promoter', target_id: a.user_id,
  })
  return ok({ decision, is_promoter: grant, brand_created: brandCreated })
}
