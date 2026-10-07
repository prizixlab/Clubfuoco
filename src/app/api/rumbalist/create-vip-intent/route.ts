import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ok, err, resolveBookingDate } from '@/lib/utils'
import { offerRunsOn } from '@/lib/partner'
import { checkVipPrice, VIP_PRICE_MESSAGES } from '@/lib/vip-price'
import { z } from 'zod'

// Create — but do NOT confirm — a PaymentIntent for a Rumbalist VIP table.
// The client confirms with Apple Pay on-device via PKPaymentRequest. We then
// verify success server-side in /api/rumbalist/confirm-vip and persist the row.
//
// Why not call /api/bookings? That route immediately confirms with a payment
// method id (card flow). Apple Pay flips the order: the *sheet* confirms the
// PaymentIntent, so we only need the client_secret here.
//
// Everything that can refuse the booking is checked HERE, before any money
// moves: the price (lib/vip-price — the client's amount is only a claim), the
// night, and that the offer runs on it. A refusal after Apple Pay leaves the
// guest charged with nothing to show for it.

const schema = z.object({
  club_id:      z.string().min(1),
  amount:       z.number().int().min(50),   // cents — checked against the offer, never trusted
  booking_date: z.string().optional(),      // older app builds don't send it
  venue_name:   z.string().max(200).optional(),
  product_name: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)
  const { club_id: clubId, amount } = parsed.data

  const supabase = await createServiceClient()

  let bookingDate: string | null = null
  if (parsed.data.booking_date !== undefined) {
    bookingDate = resolveBookingDate(parsed.data.booking_date)
    if (!bookingDate) return err('booking_date must be today or within the next 14 days')
    if (!(await offerRunsOn(supabase, clubId, 'vip_table', bookingDate))) {
      return err('VIP tables aren’t available on that night.', 409)
    }
  }

  const price = await checkVipPrice(supabase, clubId, bookingDate, amount)
  if (!price.ok) return err(VIP_PRICE_MESSAGES[price.reason], 409)

  // Look up the user's stripe customer (if any) so the payment appears in
  // their billing history. Optional — Stripe creates a guest one if absent.
  const { data: profile } = await supabase
    .from('users')
    .select('stripe_customer_id, email')
    .eq('id', user!.id)
    .single()

  try {
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'eur',
      customer: profile?.stripe_customer_id ?? undefined,
      // Apple Pay sends `card` payment methods.
      payment_method_types: ['card'],
      metadata: {
        user_id:       user!.id,
        club_id:       clubId,
        source:        'rumbalist_vip',
        // confirm-vip trusts an intent only when this route priced it.
        price_checked: '1',
        // Everything the webhook needs to write the booking if the app never
        // calls confirm-vip (see lib/vip-booking).
        ...(bookingDate ? { booking_date: bookingDate } : {}),
        ...(parsed.data.venue_name ? { venue_name: parsed.data.venue_name } : {}),
        ...(parsed.data.product_name ? { product_name: parsed.data.product_name } : {}),
      },
    })
    return ok({
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
    })
  } catch (e: unknown) {
    console.error('[create-vip-intent]', e instanceof Error ? e.message : e)
    return err('We couldn’t start the payment. You haven’t been charged.', 402)
  }
}
