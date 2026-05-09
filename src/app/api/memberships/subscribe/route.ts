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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Create a Stripe Checkout Session (hosted payment page)
  const session = await stripe.checkout.sessions.create({
    mode:               'subscription',
    customer:           customerId,
    line_items:         [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url:        `${appUrl}/membership?success=1&tier=${parsed.data.plan}`,
    cancel_url:         `${appUrl}/membership?cancelled=1`,
    subscription_data:  { metadata: { user_id: user!.id, tier: parsed.data.plan } },
    metadata:           { user_id: user!.id, tier: parsed.data.plan },
  })

  return ok({ checkout_url: session.url })
}
