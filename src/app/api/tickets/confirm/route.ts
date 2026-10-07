import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'

// POST /api/tickets/confirm
// Called client-side after stripe.confirmPayment() succeeds.
//
// Marks the order paid only when the PaymentIntent is THIS order's, for THIS
// user, for THIS amount, and succeeded. It used to check only that some
// intent had succeeded — pay €1 for one order, confirm a €300 one with it.
// (The webhook marks orders paid too; this is the fast path.)
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const { order_id, payment_intent_id } = await req.json().catch(() => ({}))
  if (typeof order_id !== 'string' || typeof payment_intent_id !== 'string') {
    return err('Missing order_id or payment_intent_id')
  }

  const supabase = await createServiceClient()
  const { data: order } = await supabase
    .from('ticket_orders')
    .select('id, status, total_cents, stripe_payment_intent')
    .eq('id', order_id)
    .eq('user_id', user!.id)
    .maybeSingle()
  if (!order) return err('Order not found', 404)
  if (order.status === 'paid') return ok({ confirmed: true })
  if (order.stripe_payment_intent !== payment_intent_id) return err('Payment does not match this order', 403)

  let intent
  try {
    intent = await stripe.paymentIntents.retrieve(payment_intent_id)
  } catch {
    return err('Couldn’t confirm the payment yet. Give it a moment.', 502)
  }
  if (intent.status !== 'succeeded') return err('Payment not confirmed', 402)
  if (intent.metadata?.user_id !== user!.id || intent.amount !== order.total_cents) {
    return err('Payment does not match this order', 403)
  }

  const { error } = await supabase
    .from('ticket_orders')
    .update({ status: 'paid' })
    .eq('id', order_id)
    .eq('user_id', user!.id)
    .neq('status', 'paid')

  if (error) return err('Could not record the payment', 500)
  return ok({ confirmed: true })
}
