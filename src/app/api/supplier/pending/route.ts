import { resolveSupplierBrand } from '@/lib/supplier-auth'
import { listOwnPending } from '@/lib/pending-changes'
import { ok, err } from '@/lib/utils'

// GET /api/supplier/pending — the caller's changes awaiting Club Fuoco review,
// so the app can show them as "in review" alongside their live offers.
export async function GET() {
  const { userId, sb, response } = await resolveSupplierBrand()
  if (response) return response
  try {
    const rows = await listOwnPending(sb, userId)
    return ok(rows.map(r => ({ id: r.id, action: r.action, summary: r.summary, created_at: r.created_at })))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not load pending changes', 500)
  }
}
