import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { buildCardVerificationSession } from '@/lib/promoter-billing'
import { ok, err } from '@/lib/utils'

/**
 * Starts the card-on-file flow for a promoter — used when they enable a paid
 * feature (e.g. front-page promotion). Creates (or reuses) a Stripe Customer and
 * a hosted, PCI-compliant Checkout Session that places a €2 verification hold on
 * the card and saves it for off-session charges later.
 *
 * The €2 is authorized with `capture_method: 'manual'` and never captured — the
 * webhook cancels it as soon as the session completes, releasing the hold. A
 * real (rather than €0) authorization is a stronger liveness check: it catches
 * prepaid, dead, or over-limit cards a €0 auth passes. No money is taken; the
 * charge is disclosed in the Promoter Terms.
 */
export async function POST(req: Request) {
  const sb = await createServiceClient()
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp } = await sb.auth.getUser(bearer)
  const user = userResp.user
  if (!user) return err('Unauthorized', 401)

  // Ensure a billing account + Stripe customer.
  const { data: acct } = await sb
    .from('promoter_billing_accounts')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()

  let customerId = acct?.stripe_customer_id ?? null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { promoter_id: user.id },
    })
    customerId = customer.id
    await sb.from('promoter_billing_accounts').upsert({
      user_id: user.id,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://clubfuoco.com'
  const session = await stripe.checkout.sessions.create(
    buildCardVerificationSession(customerId, user.id, base),
  )

  return ok({ url: session.url })
}
