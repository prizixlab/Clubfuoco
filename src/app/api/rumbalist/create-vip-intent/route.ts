import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { z } from 'zod'

// Create — but do NOT confirm — a PaymentIntent for a Rumbalist VIP table.
// The client confirms with Apple Pay on-device via PKPaymentRequest. We then
// verify success server-side in /api/rumbalist/confirm-vip and persist the row.
//
// Why not call /api/bookings? That route immediately confirms with a payment
// method id (card flow). Apple Pay flips the order: the *sheet* confirms the
// PaymentIntent, so we only need the client_secret here.

const schema = z.object({
  club_id:  z.string().min(1),
  amount:   z.number().int().min(50),   // cents (min €0.50)
  currency: z.string().default('eur'),
})

export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  // Look up the user's stripe customer (if any) so the payment appears in
  // their billing history. Optional — Stripe creates a guest one if absent.
  const supabase = await createServiceClient()
  const { data: profile } = await supabase
    .from('users')
    .select('stripe_customer_id, email')
    .eq('id', user!.id)
    .single()

  try {
    const intent = await stripe.paymentIntents.create({
      amount:   parsed.data.amount,
      currency: parsed.data.currency,
      customer: profile?.stripe_customer_id ?? undefined,
      // Apple Pay sends `card` payment methods.
      payment_method_types: ['card'],
      metadata: {
        user_id:      user!.id,
        club_id:      parsed.data.club_id,
        source:       'rumbalist_vip',
      },
    })
    return ok({
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Stripe error'
    return err(msg, 402)
  }
}
