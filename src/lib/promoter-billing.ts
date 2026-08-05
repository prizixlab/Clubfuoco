import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

/**
 * Pure, dependency-free pieces of the promoter card-on-file flow, extracted so
 * they can be unit-tested without touching Stripe or a database (the routes
 * that use them run against live Stripe keys, which must never be exercised by
 * a test). See promoter-billing.test.ts.
 */

/** The Checkout session that places the €2 verification hold and saves the card. */
export function buildCardVerificationSession(
  customerId: string,
  userId: string,
  base: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: { name: 'Card verification — temporary €2 hold, released immediately' },
        unit_amount: 200,
      },
      quantity: 1,
    }],
    payment_intent_data: {
      // Authorize only — applyCardVerification cancels it, so the €2 is a
      // liveness check, never a captured charge. The saved card is what we keep.
      capture_method: 'manual',
      setup_future_usage: 'off_session',
      metadata: { promoter_id: userId, purpose: 'card_verification' },
    },
    success_url: `${base}/billing/saved?ok=1`,
    cancel_url: `${base}/billing/saved?cancelled=1`,
    metadata: { promoter_id: userId, purpose: 'card_verification' },
  }
}

/**
 * On the verification session completing: save the card as the customer's
 * default for off-session charges, then release the €2 hold by cancelling the
 * still-uncaptured PaymentIntent. Idempotent-safe: cancel only runs while the
 * PI is `requires_capture`.
 */
export async function applyCardVerification(
  sb: SB,
  stripeClient: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const m = session.metadata
  const pi = await stripeClient.paymentIntents.retrieve(session.payment_intent as string)
  const pmId = pi.payment_method as string | null

  if (pmId && session.customer && m?.promoter_id) {
    const pm = await stripeClient.paymentMethods.retrieve(pmId)
    await stripeClient.customers.update(session.customer as string, {
      invoice_settings: { default_payment_method: pmId },
    })
    await sb.from('promoter_billing_accounts').upsert({
      user_id: m.promoter_id,
      stripe_customer_id: session.customer as string,
      default_payment_method_id: pmId,
      card_verified: true,
      card_brand: pm.card?.brand ?? null,
      card_last4: pm.card?.last4 ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  }

  // Release the hold — it only ever proved the card is live.
  if (pi.status === 'requires_capture') {
    await stripeClient.paymentIntents.cancel(pi.id)
  }
}

/**
 * The push to send when an off-session charge fails, or null to send nothing.
 * We notify only on the transition INTO a gated state (prevStatus 'active'), so
 * a billing run that fails several of a promoter's nights fires one push, not
 * one per night.
 */
export function failureNotification(
  reason: string,
  prevStatus: string,
): { title: string; body: string } | null {
  if (prevStatus !== 'active') return null
  return {
    title: 'Payment needs attention',
    body: reason === 'no_card_on_file'
      ? 'Add a card to pay for front-page promotion. Your nights and guest lists are unaffected.'
      : 'A front-page promotion charge didn’t go through. Update your card to resume promotion — your nights and guest lists are unaffected.',
  }
}
