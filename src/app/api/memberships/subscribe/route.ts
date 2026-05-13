import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe, MEMBERSHIP_PLANS } from '@/lib/stripe'
import { z } from 'zod'

const subscribeSchema = z.object({
  plan: z.enum(['gold', 'sapphire', 'black']),
})

// POST /api/memberships/subscribe
// Returns a Stripe Checkout Session URL; client redirects there to pay.
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body   = await request.json()
  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const plan = MEMBERSHIP_PLANS[parsed.data.plan]
  if (!plan?.stripe_price_id) return err('Membership tier not configured', 500)

  const supabase = await createClient()

  // Get or create Stripe customer
  const { data: profile } = await supabase
    .from('users')
    .select('stripe_customer_id, email, full_name')
    .eq('id', user!.id)
    .single()

  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    profile?.email ?? user!.email ?? '',
      name:     profile?.full_name ?? undefined,
      metadata: { user_id: user!.id },
    })
    customerId = customer.id

    await supabase
      .from('users')
      .update({ stripe_customer_id: customerId })
      .eq('id', user!.id)
  }

  // Create a subscription in incomplete state so we can confirm it natively
  // (Apple Pay sheet / web fallback both use the PaymentIntent client_secret)
  const subscription = await stripe.subscriptions.create({
    customer:         customerId,
    items:            [{ price: plan.stripe_price_id }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand:           ['latest_invoice.payment_intent'],
    metadata:         { user_id: user!.id, tier: parsed.data.plan },
  })

  const invoice = subscription.latest_invoice as import('stripe').Stripe.Invoice
  const pi      = invoice?.payment_intent as import('stripe').Stripe.PaymentIntent | null
  const secret  = pi?.client_secret ?? null

  if (!secret) return err('Could not initialise payment', 500)

  return ok({ client_secret: secret, subscription_id: subscription.id })
}
