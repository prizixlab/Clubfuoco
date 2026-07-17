import { brandOrNull } from '@/lib/supplier-auth'
import { listOwnPending } from '@/lib/pending-changes'
import { ok, err } from '@/lib/utils'

// GET /api/offers/pending — the caller's changes awaiting Club Fuoco review,
// so the app can show them as "in review" alongside their live offers.
export async function GET() {
  // Keyed by submitter, so it works before a brand exists.
  const { userId, sb, response } = await brandOrNull()
  if (response) return response
  try {
    const rows = await listOwnPending(sb, userId)
    return ok(rows.map(r => ({ id: r.id, action: r.action, summary: r.summary, created_at: r.created_at })))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not load pending changes', 500)
  }
}
