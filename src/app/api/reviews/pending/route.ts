import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok } from '@/lib/utils'
import { pendingReviewTargets } from '@/lib/review-targets'

// GET /api/reviews/pending — the user's Fourvenues tickets and invite
// guestlist spots still waiting for a morning-after review (7 nights back to
// 30 ahead), shaped like bookings plus `review_source`. Bookings aren't here:
// the app lists those from its own bookings query.
export const dynamic = 'force-dynamic'

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  return ok(await pendingReviewTargets(await createServiceClient(), user!.id))
}
