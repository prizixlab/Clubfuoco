import { ok } from '@/lib/utils'
import { MEMBERSHIP_PLANS } from '@/lib/stripe'

// GET /api/memberships/plans — public, no auth required
export async function GET() {
  return ok(Object.values(MEMBERSHIP_PLANS))
}
