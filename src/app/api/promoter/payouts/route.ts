import { NextRequest } from 'next/server'
import { resolvePromoterCaller } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'
import {
  payoutAccount, ensureConnectAccount, onboardingLink, dashboardLink, canCharge,
} from '@/lib/connect'
import { formatFeeBps } from '@/lib/platform-fee'
import { stripe } from '@/lib/stripe'

// The promoter's own view of getting paid.
//
// GET  → where they are in Stripe's onboarding, and what Stripe still wants.
// POST → a hosted link: onboarding if they aren't cleared yet, otherwise their
//        Stripe Express dashboard.
//
// Caller-scoped like /api/promoter/pass-theme: no id in the path, so a promoter
// can only ever address their own account.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clubfuoco.com'

export async function GET() {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const account = await payoutAccount(sb, userId)

  // Refresh from Stripe whenever there IS an account — not only when it looks
  // disabled.
  //
  // The `!charges_enabled` version of this check was wrong in the direction
  // that costs money. It caught a promoter finishing onboarding, but never the
  // reverse: once enabled, we stopped asking, so an account Stripe LATER
  // disables — an expired document, a requirement falling past due — kept
  // reading as sellable in our mirror. We would go on letting them price and
  // sell nights whose guests then die at the card form, which is precisely the
  // moment this whole gate exists to avoid.
  //
  // One Stripe call per open of this screen is a fair price for the mirror
  // being right in both directions.
  if (account.stripe_account_id) {
    try {
      const fresh = await stripe.accounts.retrieve(account.stripe_account_id)
      const { syncAccount } = await import('@/lib/connect')
      await syncAccount(sb, fresh)
      return ok(shape(await payoutAccount(sb, userId)))
    } catch (e) {
      // Stripe unreachable — show what we last knew rather than an error.
      console.warn('[payouts] could not refresh from Stripe:', e instanceof Error ? e.message : e)
    }
  }

  return ok(shape(account))
}

function shape(a: Awaited<ReturnType<typeof payoutAccount>>) {
  return {
    onboarded: Boolean(a.stripe_account_id),
    can_charge: canCharge(a),
    payouts_enabled: a.payouts_enabled,
    details_submitted: a.details_submitted,
    // Stripe's own field names, passed through untranslated. Paraphrasing
    // "individual.verification.document" into something friendlier is how a
    // promoter ends up stuck with no idea what to upload.
    requirements_due: a.requirements_due,
    disabled_reason: a.disabled_reason,
    country: a.country,
    currency: a.default_currency,
    // Both rates: a promoter running public offers and private events is on
    // two different deals, and showing one number would misstate one of them.
    fee_percent: formatFeeBps(a.platform_fee_bps),
    fee_bps: a.platform_fee_bps,
    public_fee_percent: formatFeeBps(a.platform_fee_public_bps),
    public_fee_bps: a.platform_fee_public_bps,
  }
}

// POST { country? } → { url, kind: 'onboarding' | 'dashboard' }
export async function POST(request: NextRequest) {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const body = await request.json().catch(() => ({}))

  const existing = await payoutAccount(sb, userId)

  // Already cleared → they want to see their money, not redo onboarding.
  if (existing.stripe_account_id && canCharge(existing)) {
    try {
      return ok({ url: await dashboardLink(existing.stripe_account_id), kind: 'dashboard' })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Could not open Stripe', 502)
    }
  }

  try {
    const { data: profile } = await sb
      .from('users').select('email').eq('id', userId).maybeSingle()

    // Country is fixed by Stripe at creation and can NEVER be changed — an
    // account made in the wrong one has to be abandoned, taking its KYC with
    // it. Defaulted to ES because that is where the promoters are; accepted
    // from the client only on first creation.
    const country = typeof body.country === 'string' && /^[A-Z]{2}$/.test(body.country)
      ? body.country
      : 'ES'

    const accountId = await ensureConnectAccount(sb, userId, {
      email: (profile as { email?: string } | null)?.email ?? null,
      country,
    })
    return ok({ url: await onboardingLink(accountId, APP_URL), kind: 'onboarding' })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not start payout setup'
    console.error('[payouts] onboarding failed:', message)
    // Stripe's message is the useful one here ("Connect is not enabled",
    // "country not supported"), so it is surfaced rather than swallowed.
    return err(message, 502)
  }
}
