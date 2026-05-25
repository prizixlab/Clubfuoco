import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { randomUUID } from 'crypto'
import { z } from 'zod'

// Verify with Stripe that the Apple Pay confirmation actually succeeded,
// then write the booking row. The client cannot be trusted to claim success.

const schema = z.object({
  payment_intent_id: z.string().min(1),
  club_id:           z.string().min(1),
})

export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  // 1. Verify with Stripe
  let intent
  try {
    intent = await stripe.paymentIntents.retrieve(parsed.data.payment_intent_id)
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : 'Stripe lookup failed', 402)
  }
  if (intent.status !== 'succeeded') {
    return err(`Payment not completed (status: ${intent.status})`, 402)
  }
  if (intent.metadata?.user_id !== user!.id) {
    return err('Payment does not belong to this user', 403)
  }

  // 2. Idempotency — if we already wrote this booking, return it
  const supabase = await createServiceClient()
  const { data: existing } = await supabase
    .from('bookings')
    .select('*')
    .eq('stripe_payment_intent_id', intent.id)
    .maybeSingle()
  if (existing) return ok(existing)

  // 3. Insert booking row
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
  const total = intent.amount / 100   // cents → euros
  const { data: booking, error: insertErr } = await supabase
    .from('bookings')
    .insert({
      user_id:                   user!.id,
      club_id:                   parsed.data.club_id,
      booking_type:              'vip',
      party_size:                1,
      booking_date:              tomorrow,
      status:                    'confirmed',
      unit_price:                total,
      total_amount:              total,
      platform_fee:              0,
      stripe_payment_intent_id:  intent.id,
      qr_code_token:             randomUUID(),
    })
    .select('*')
    .single()
  if (insertErr) return err(insertErr.message)

  return ok(booking)
}
