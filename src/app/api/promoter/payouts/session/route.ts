import { resolvePromoterCaller } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'
import { payoutAccount, ensureConnectAccount, accountSession } from '@/lib/connect'

// POST /api/promoter/payouts/session   { country? } → { client_secret }
//
// The in-app replacement for the hosted onboarding link. Returns a single-use
// client secret that drives Stripe's *embedded* Connect components inside the
// iOS StripeConnect SDK — the promoter finishes KYC without ever leaving Fuoco.
//
// Creates the Connect account on first call, exactly like the hosted POST in
// ../route.ts, so a promoter who has never set up payouts can start here. The
// account id never reaches the client; only the ephemeral client secret does.
//
// Caller-scoped: no id in the path, so a promoter can only ever open a session
// for their own account.

export async function POST(request: Request) {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const body = await request.json().catch(() => ({}))

  try {
    let account = await payoutAccount(sb, userId)

    if (!account.stripe_account_id) {
      // Country is fixed by Stripe at creation and can never change — an
      // account made in the wrong one is unrecoverable. Defaulted to ES (where
      // the promoters are); accepted from the client only on first creation.
      const country = typeof body.country === 'string' && /^[A-Z]{2}$/.test(body.country)
        ? body.country
        : 'ES'
      const { data: profile } = await sb
        .from('users').select('email').eq('id', userId).maybeSingle()
      await ensureConnectAccount(sb, userId, {
        email: (profile as { email?: string } | null)?.email ?? null,
        country,
      })
      account = await payoutAccount(sb, userId)
    }

    if (!account.stripe_account_id) {
      return err('Could not start payout setup', 502)
    }

    const clientSecret = await accountSession(account.stripe_account_id)
    return ok({ client_secret: clientSecret })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not start payout setup'
    console.error('[payouts/session]', message)
    // Stripe's message is the useful one ("Connect is not enabled",
    // "embedded components not enabled"), so surface it rather than swallow it.
    return err(message, 502)
  }
}
