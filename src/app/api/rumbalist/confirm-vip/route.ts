import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { checkVipPrice } from '@/lib/vip-price'
import { writeVipBooking } from '@/lib/vip-booking'
import { z } from 'zod'

// Verify with Stripe that the Apple Pay confirmation actually succeeded,
// then write the booking row. The client cannot be trusted to claim success.
//
// The row itself is written by lib/vip-booking, shared with the Stripe
// webhook — so if this request never arrives, the webhook books the table,
// and if both run, they agree on one row. Safe for the app to retry.

const schema = z.object({
  payment_intent_id: z.string().min(1),
  club_id:           z.string().min(1),
  venue_name:        z.string().optional(),
  product_name:      z.string().optional(),
  booking_date:      z.string().optional(),
})

export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err('Invalid request')

  // 1. Verify with Stripe
  let intent
  try {
    intent = await stripe.paymentIntents.retrieve(parsed.data.payment_intent_id)
  } catch (e: unknown) {
    console.error('[confirm-vip] stripe lookup', e instanceof Error ? e.message : e)
    return err('Couldn’t confirm the payment yet. Give it a moment.', 502)
  }
  if (intent.status !== 'succeeded') {
    return err('The payment didn’t go through. You haven’t been charged.', 402)
  }
  if (intent.metadata?.user_id !== user!.id) {
    return err('Payment does not belong to this user', 403)
  }
  // The table is booked at the club the payment was made for — not whichever
  // club the confirm request names.
  if (intent.metadata?.source !== 'rumbalist_vip' || intent.metadata?.club_id !== parsed.data.club_id) {
    return err('Payment does not match this table', 403)
  }

  const supabase = await createServiceClient()

  // An intent create-vip-intent didn't price (made before that check
  // existed) must still be for a real VIP price at this club.
  if (intent.metadata?.price_checked !== '1') {
    const price = await checkVipPrice(supabase, parsed.data.club_id, null, intent.amount)
    if (!price.ok) {
      console.error('[confirm-vip] unpriced intent refused', intent.id, intent.amount, price.reason)
      return err('This payment doesn’t match a VIP table price. Contact support for a refund.', 409)
    }
  }

  const result = await writeVipBooking(supabase, intent, {
    bookingDate: parsed.data.booking_date,
    venueName:   parsed.data.venue_name,
    productName: parsed.data.product_name,
  })
  if (!result.ok) return err(result.error, result.status)
  return ok(result.booking)
}
