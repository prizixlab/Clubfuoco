import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { verifyTransaction, applyTransaction } from '@/lib/apple-iap'

/**
 * POST /api/memberships/iap/verify
 *
 * Called by the iOS app after a StoreKit purchase OR a "Restore Purchases".
 * Accepts one signed transaction JWS, or a list of them (restore/entitlements).
 * Each JWS is verified against Apple's certificate chain server-side — the
 * device's claim is never trusted — then the membership tier is granted.
 */
const bodySchema = z.object({
  jws:          z.string().min(1).optional(),
  entitlements: z.array(z.object({ jws: z.string().min(1) })).optional(),
}).refine(b => b.jws || (b.entitlements && b.entitlements.length), {
  message: 'Provide `jws` or a non-empty `entitlements` array',
})

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')

  const jwsList = parsed.data.jws
    ? [parsed.data.jws]
    : parsed.data.entitlements!.map(e => e.jws)

  let granted: { tier: string; active: boolean } | null = null

  for (const jws of jwsList) {
    let tx
    try {
      tx = await verifyTransaction(jws)
    } catch {
      // Skip transactions that fail Apple signature verification.
      continue
    }
    const result = await applyTransaction(tx, user!.id)
    // Keep the highest active tier seen (restore may return several).
    if (result?.active) granted = result
    else if (result && !granted) granted = result
  }

  if (!granted) return err('No valid Club Fuoco membership found in this purchase', 422)
  return ok(granted)
}
