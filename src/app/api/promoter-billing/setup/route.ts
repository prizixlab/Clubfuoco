import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'

/**
 * Starts the card-on-file flow for a promoter. Creates (or reuses) a Stripe
 * Customer and a Checkout Session in `setup` mode — a hosted, PCI-compliant
 * card form that validates the card (€0 auth) and saves it for off-session
 * charges later. Returns the hosted URL for the promoter to open.
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
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customerId,
    payment_method_types: ['card'],
    success_url: `${base}/billing/saved?ok=1`,
    cancel_url: `${base}/billing/saved?cancelled=1`,
    metadata: { promoter_id: user.id },
  })

  return ok({ url: session.url })
}
