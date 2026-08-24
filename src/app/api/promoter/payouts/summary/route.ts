import { resolvePromoterCaller } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'
import { payoutAccount, payoutSummary } from '@/lib/connect'

// GET /api/promoter/payouts/summary → the promoter's money, for the native
// in-app tracking screen: current balance, what's still clearing, lifetime
// paid to their bank, and recent payouts with their status.
//
// Read off the CONNECTED account's own balance — destination-charge funds land
// there, never on the platform. A promoter who hasn't set up payouts yet gets a
// clean empty summary (all zeros) rather than an error, so the screen can say
// "nothing yet" instead of breaking.
//
// Caller-scoped: no id in the path.

export async function GET() {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const account = await payoutAccount(sb, userId)

  if (!account.stripe_account_id) {
    return ok({
      onboarded: false,
      currency: (account.default_currency ?? 'eur'),
      available_cents: 0,
      pending_cents: 0,
      paid_out_cents: 0,
      payouts: [],
    })
  }

  try {
    const summary = await payoutSummary(account.stripe_account_id)
    return ok({ onboarded: true, ...summary })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not load payouts'
    console.error('[payouts/summary]', message)
    return err(message, 502)
  }
}
