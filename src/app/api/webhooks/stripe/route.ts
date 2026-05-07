import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import type Stripe from 'stripe'

// POST /api/webhooks/stripe
// Handles all Stripe events — payment confirmations, subscription lifecycle
// Must be excluded from CSRF protection (raw body required)
export async function POST(request: NextRequest) {
  const body      = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return NextResponse.json({ error: err.message }, { status: 400 })
  }

  // Service client bypasses RLS — needed for cross-user updates
  const supabase = await createServiceClient()

  try {
    switch (event.type) {
      // ---- One-time booking payments ----

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.qr_token) {
          await supabase
            .from('bookings')
            .update({
              status:          'confirmed',
              stripe_charge_id: pi.latest_charge as string,
            })
            .eq('stripe_payment_intent_id', pi.id)
            .eq('status', 'pending')
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.qr_token) {
          await supabase
            .from('bookings')
            .update({ status: 'cancelled' })
            .eq('stripe_payment_intent_id', pi.id)
        }
        break
      }

      // ---- Subscription lifecycle ----

      case 'customer.subscription.updated': {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        if (!userId) break

        const isActive = sub.status === 'active'
        const newStatus = isActive ? 'active' : 'past_due'

        await supabase
          .from('memberships')
          .update({ status: newStatus })
          .eq('stripe_subscription_id', sub.id)

        if (isActive) {
          const tier = sub.metadata?.tier as 'gold' | 'sapphire' | undefined
          if (tier) {
            await supabase
              .from('users')
              .update({ membership_tier: tier })
              .eq('id', userId)
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        if (!userId) break

        await supabase
          .from('memberships')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', sub.id)

        await supabase
          .from('users')
          .update({ membership_tier: 'free' })
          .eq('id', userId)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId   = (invoice as any).subscription as string | null
        if (subId) {
          await supabase
            .from('memberships')
            .update({ status: 'past_due' })
            .eq('stripe_subscription_id', subId)
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subId   = (invoice as any).subscription as string | null
        if (subId) {
          await supabase
            .from('memberships')
            .update({ status: 'active' })
            .eq('stripe_subscription_id', subId)
        }
        break
      }
    }
  } catch (err) {
    console.error('Error processing Stripe webhook event:', event.type, err)
    // Return 200 anyway — Stripe will retry on 5xx
  }

  return NextResponse.json({ received: true })
}
