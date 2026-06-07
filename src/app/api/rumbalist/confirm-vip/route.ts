import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { generateReferenceCode } from '@/lib/rumbalist-reference'
import { z } from 'zod'

// Verify with Stripe that the Apple Pay confirmation actually succeeded,
// then write the booking row. The client cannot be trusted to claim success.

const schema = z.object({
  payment_intent_id: z.string().min(1),
  club_id:           z.string().min(1),
  venue_name:        z.string().optional(),
  product_name:      z.string().optional(),
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

  // 3. Insert booking row — retry on reference-code collision (Postgres unique
  //    violation = 23505). Five attempts is overkill at 1/2.8-trillion odds.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
  const total = intent.amount / 100   // cents → euros
  let booking: any = null
  let insertErr: any = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferenceCode()
    const res  = await supabase
      .from('bookings')
      .insert({
        user_id:                   user!.id,
        club_id:                   parsed.data.club_id,
        booking_type:              'vip',
        party_size:                1,
        booking_date:               tomorrow,
        status:                    'confirmed',
        unit_price:                total,
        total_amount:              total,
        platform_fee:              0,
        stripe_payment_intent_id:  intent.id,
        qr_code_token:             code,
      })
      .select('*')
      .single()
    booking   = res.data
    insertErr = res.error
    if (!insertErr) break
    if (insertErr.code !== '23505') break
  }
  if (insertErr) return err(insertErr.message)

  // 4. Rumbalist purchase audit row — non-fatal on failure so we don't lose
  //    the user's paid booking if the audit table is missing.
  try {
    const { data: profile } = await supabase
      .from('users')
      .select('full_name, email, phone')
      .eq('id', user!.id)
      .single()
    await supabase.from('rumbalist_purchases').insert({
      user_id:                  user!.id,
      full_name:                profile?.full_name ?? null,
      email:                    profile?.email ?? null,
      phone:                    profile?.phone ?? null,
      venue_id:                 parsed.data.club_id,
      venue_name:               parsed.data.venue_name ?? 'Unknown venue',
      product_name:             parsed.data.product_name ?? 'VIP Table',
      product_kind:             'vip_table',
      price_eur:                total,
      event_date:               tomorrow,
      stripe_payment_intent_id: intent.id,
      booking_id:               booking.id,
    })
  } catch (auditErr) {
    console.error('rumbalist_purchases insert failed (non-fatal):', auditErr)
  }

  return ok(booking)
}
