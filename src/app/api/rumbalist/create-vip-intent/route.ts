import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ok, err, resolveBookingDate } from '@/lib/utils'
import { offerRunsOn } from '@/lib/partner'
import { checkVipPrice, VIP_PRICE_MESSAGES } from '@/lib/vip-price'
import { quoteTable, TABLE_QUOTE_MESSAGES } from '@/lib/vip-products'
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
  // A table from the club's saved Fourvenues tables, sold on Fuoco checkout by
  // the promoter who holds its buy button tonight (lib/vip-products). Newer
  // builds only; booking_date is then required.
  table: z.object({
    zone:  z.string().min(1).max(120),     // the zone's name; normalised server-side
    rate:  z.string().min(1).max(64),
    pax:   z.number().int().min(1).max(50),
    pay:   z.enum(['deposit', 'full']),
  }).optional(),
})

export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)
  const { club_id: clubId, amount } = parsed.data

  const supabase = await createServiceClient()

  // ── A saved table, on Fuoco checkout ──────────────────────────────────────
  if (parsed.data.table) {
    const night = resolveBookingDate(parsed.data.booking_date)
    if (!night) return err('booking_date must be today or within the next 14 days')
    const t = parsed.data.table
    const quote = await quoteTable(supabase, {
      clubId, night, zoneKey: t.zone, rateId: t.rate, pax: t.pax, mode: t.pay, amountCents: amount,
    })
    if (!quote.ok) return err(TABLE_QUOTE_MESSAGES[quote.reason], 409)
    return createIntent(supabase, user!.id, amount, {
      user_id:       user!.id,
      club_id:       clubId,
      source:        'rumbalist_vip',
      price_checked: '1',
      booking_date:  night,
      brand_id:      quote.seller.brand_id,
      table_zone:    quote.zoneName,
      table_rate:    t.rate,
      table_pax:     String(t.pax),
      table_pay:     t.pay,
      table_price:   String(quote.tablePrice),
      ...(quote.productId ? { vip_product_id: quote.productId } : {}),
      ...(parsed.data.venue_name ? { venue_name: parsed.data.venue_name } : {}),
      product_name:  [quote.zoneName, quote.rate.name].filter(Boolean).join(' · ').slice(0, 200),
    })
  }

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

  return createIntent(supabase, user!.id, amount, {
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
  })
}

type SB = Awaited<ReturnType<typeof createServiceClient>>

/** An unconfirmed card PaymentIntent; the app confirms it with Apple Pay. */
async function createIntent(sb: SB, userId: string, amount: number, metadata: Record<string, string>) {
  // Look up the user's stripe customer (if any) so the payment appears in
  // their billing history. Optional — Stripe creates a guest one if absent.
  const { data: profile } = await sb
    .from('users')
    .select('stripe_customer_id, email')
    .eq('id', userId)
    .single()

  try {
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'eur',
      customer: profile?.stripe_customer_id ?? undefined,
      // Apple Pay sends `card` payment methods.
      payment_method_types: ['card'],
      metadata,
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
