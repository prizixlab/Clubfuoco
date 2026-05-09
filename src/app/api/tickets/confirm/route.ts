import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'

// POST /api/tickets/confirm
// Called client-side after stripe.confirmPayment() succeeds.
// Verifies the PaymentIntent with Stripe and marks the order as paid.
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const { order_id, payment_intent_id } = await req.json()
  if (!order_id || !payment_intent_id) return err('Missing order_id or payment_intent_id')

  // Verify with Stripe that the payment actually succeeded
  const intent = await stripe.paymentIntents.retrieve(payment_intent_id)
  if (intent.status !== 'succeeded') return err('Payment not confirmed', 402)

  const supabase = await createServiceClient()

  const { error } = await supabase
    .from('ticket_orders')
    .update({ status: 'paid' })
    .eq('id', order_id)
    .eq('user_id', user!.id)  // user can only confirm their own orders

  if (error) return err(error.message)
  return ok({ confirmed: true })
}
