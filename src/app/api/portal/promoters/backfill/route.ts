import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { provisionBrandForUser } from '@/lib/offer-auth'
import { getBrandByOwner } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST /api/portal/promoters/backfill — one-shot: give every already-approved
// promoter (users.is_promoter) a brand, matching the new provision-on-approval
// behaviour for accounts approved before it existed. Idempotent (skips anyone
// who already owns a brand), so it's safe to run more than once. Portal-gated.
export async function POST() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const { data: users, error } = await sb
    .from('users')
    .select('id')
    .eq('is_promoter', true)
  if (error) return err(error.message, 500)

  const ids = (users ?? []).map(u => (u as { id: string }).id)
  const provisioned: string[] = []
  const failed: { user_id: string; error: string }[] = []

  for (const userId of ids) {
    try {
      if (await getBrandByOwner(sb, userId)) continue
      const brand = await provisionBrandForUser(sb, userId)
      provisioned.push(userId)
      await logAudit(sb, {
        action: 'brand.provision',
        summary: `Backfilled brand “${brand.name}” for promoter ${userId}`,
        target_type: 'promoter', target_id: userId,
      })
    } catch (e) {
      failed.push({ user_id: userId, error: e instanceof Error ? e.message : 'unknown' })
    }
  }

  return ok({ approved: ids.length, provisioned: provisioned.length, failed })
}
