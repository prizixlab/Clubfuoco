import type { createServiceClient } from '@/lib/supabase/server'
import { provisionBrandForUser } from '@/lib/offer-auth'
import { getBrandByOwner } from '@/lib/partner'
import { AUTO_APPROVE_PROMOTERS, getBoolSetting } from '@/lib/app-settings'

type SB = Awaited<ReturnType<typeof createServiceClient>>

/**
 * The one place a promoter application turns into promoter access. Three paths
 * call it — the portal's manual Approve, the auto-approve toggle's sweep of the
 * existing queue, and signup itself while auto-approve is on — and they must
 * leave the account in the same state, or a promoter approved one way behaves
 * differently in the app from one approved another way.
 */
export async function grantPromoterAccess(
  sb: SB,
  app: { id: string; user_id: string },
  /**
   * Whether to also stamp the Instagram check as verified. TRUE only for a
   * human approval, where someone actually confirmed the DM'd code came from
   * the claimed account. Auto-approval grants access but leaves the handle
   * unverified — access is a decision the operator delegated to the toggle,
   * "we checked their Instagram" is a claim nobody made.
   */
  { markIgVerified }: { markIgVerified: boolean },
): Promise<{ brandCreated: boolean }> {
  const { error: appErr } = await sb
    .from('promoter_applications')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      ...(markIgVerified ? { ig_verified: true } : {}),
    })
    .eq('id', app.id)
  if (appErr) throw new Error(appErr.message)

  const { error: userErr } = await sb
    .from('users')
    .update({ is_promoter: true })
    .eq('id', app.user_id)
  if (userErr) throw new Error(userErr.message)

  // A promoter and their brand are one entity — see the manual approve route.
  const before = await getBrandByOwner(sb, app.user_id)
  await provisionBrandForUser(sb, app.user_id)
  return { brandCreated: !before }
}

/** Is new-promoter auto-approval on? Defaults to off (see getBoolSetting). */
export async function autoApprovePromotersOn(sb: SB): Promise<boolean> {
  return getBoolSetting(sb, AUTO_APPROVE_PROMOTERS)
}

/**
 * Approve everyone already waiting. Turning the toggle on means "nobody is
 * waiting on me" — present and future — exactly like the Changes toggle, so
 * the operator isn't left with a queue that the switch no longer feeds.
 *
 * One row that can't be granted (a deleted account, say) is skipped rather
 * than failing the whole sweep.
 */
export async function approveAllPendingPromoters(sb: SB): Promise<number> {
  let approved = 0
  try {
    const { data, error } = await sb
      .from('promoter_applications')
      .select('id, user_id')
      .eq('status', 'pending')
      .limit(500)
    if (error) return 0
    for (const row of (data ?? []) as { id: string; user_id: string }[]) {
      try {
        await grantPromoterAccess(sb, row, { markIgVerified: false })
        approved++
      } catch { /* skip this application, keep sweeping */ }
    }
  } catch { /* table missing → nothing to sweep */ }
  return approved
}
