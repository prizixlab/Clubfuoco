import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { onboardingLink } from '@/lib/connect'

// Stripe's `refresh_url`: where someone lands when their onboarding link
// expires or is reopened from a stale tab.
//
// Account links are single-use and short-lived, so this WILL be hit in normal
// use — someone who steps away mid-form and comes back. Without it they get a
// dead Stripe page holding half-uploaded documents. This mints a fresh link and
// sends them straight back in.
//
// No session required: the account id comes from the query string Stripe
// carries, and the only thing this can do is open that account's own
// onboarding — which is already gated behind Stripe's own identity checks.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const accountId = url.searchParams.get('account')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clubfuoco.com'

  if (!accountId) redirect('/payouts/done?state=expired')

  try {
    // Confirm it is one of ours before minting anything against it.
    const account = await stripe.accounts.retrieve(accountId)
    if (!account.metadata?.club_fuoco_user_id) redirect('/payouts/done?state=expired')

    const sb = await createServiceClient()
    const { syncAccount } = await import('@/lib/connect')
    await syncAccount(sb, account)

    redirect(await onboardingLink(accountId, appUrl))
  } catch (e) {
    // redirect() throws by design — let it through rather than treating the
    // control flow as a failure.
    if (e && typeof e === 'object' && 'digest' in e) throw e
    console.error('[payouts/refresh]', e instanceof Error ? e.message : e)
    redirect('/payouts/done?state=expired')
  }
}
