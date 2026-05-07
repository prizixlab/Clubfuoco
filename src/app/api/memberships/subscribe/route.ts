import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe, MEMBERSHIP_PLANS } from '@/lib/stripe'
import { z } from 'zod'

const subscribeSchema = z.object({
  tier:              z.enum(['gold', 'sapphire']),
  payment_method_id: z.string().min(1),
})

// POST /api/memberships/subscribe
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body   = await request.json()
  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const plan = MEMBERSHIP_PLANS[parsed.data.tier]
  if (!plan.stripe_price_id) return err('Membership tier not configured', 500)

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

  // Attach payment method + set as default
  await stripe.paymentMethods.attach(parsed.data.payment_method_id, {
    customer: customerId,
  })
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: parsed.data.payment_method_id },
  })

  // Create subscription
  const subscription = await stripe.subscriptions.create({
    customer:         customerId,
    items:            [{ price: plan.stripe_price_id }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    metadata:         { user_id: user!.id, tier: parsed.data.tier },
  })

  // Persist membership + update user tier
  await supabase
    .from('memberships')
    .upsert(
      {
        user_id:                user!.id,
        tier:                   parsed.data.tier,
        stripe_subscription_id: subscription.id,
        stripe_price_id:        plan.stripe_price_id,
        status:                 'active',
        valid_from:             new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

  await supabase
    .from('users')
    .update({ membership_tier: parsed.data.tier })
    .eq('id', user!.id)

  return ok({ subscription_id: subscription.id, tier: parsed.data.tier }, 201)
}
