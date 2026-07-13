import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/promoters — the promoter-account approval queue plus the
// current roster. Applications come from the FuocoPromoters signup flow
// (instagram + IG verification code); approving one is what actually grants
// app access (users.is_promoter). Supplier logins (accounts that own a
// partner_brand) are excluded from the roster — they're managed on the
// Suppliers tab, not here.
export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const [{ data: apps, error: appErr }, { data: owners }] = await Promise.all([
    sb.from('promoter_applications')
      .select('id, user_id, instagram, clubs, experience, status, ig_code, ig_verified, created_at, reviewed_at')
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('partner_brands').select('owner_user_id').not('owner_user_id', 'is', null),
  ])
  if (appErr) return err(appErr.message, 500)
  const supplierIds = new Set((owners ?? []).map(o => (o as { owner_user_id: string }).owner_user_id))

  // Join in the account (email/name/is_promoter) for each applicant.
  const userIds = [...new Set((apps ?? []).map(a => (a as { user_id: string }).user_id))]
  const userById: Record<string, { email: string | null; full_name: string | null; is_promoter: boolean }> = {}
  if (userIds.length) {
    const { data: users } = await sb.from('users').select('id, email, full_name, is_promoter').in('id', userIds)
    for (const u of users ?? []) {
      const r = u as { id: string; email: string | null; full_name: string | null; is_promoter: boolean }
      userById[r.id] = { email: r.email, full_name: r.full_name, is_promoter: r.is_promoter }
    }
  }

  const rows = (apps ?? [])
    .filter(a => !supplierIds.has((a as { user_id: string }).user_id))
    .map(a => {
      const r = a as Record<string, unknown>
      const u = userById[r.user_id as string]
      return {
        id: r.id, user_id: r.user_id,
        email: u?.email ?? null, full_name: u?.full_name ?? null,
        instagram: r.instagram, clubs: r.clubs, experience: r.experience,
        status: r.status, ig_code: r.ig_code, ig_verified: r.ig_verified,
        is_promoter: u?.is_promoter ?? false,
        created_at: r.created_at, reviewed_at: r.reviewed_at,
      }
    })

  return ok({
    pending: rows.filter(r => r.status === 'pending'),
    decided: rows.filter(r => r.status !== 'pending').slice(0, 50),
  })
}
