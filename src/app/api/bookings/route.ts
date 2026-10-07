import { createAuthedClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err, generateQRToken, resolveBookingDate } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe, calculateOrderTotal } from '@/lib/stripe'
import { z } from 'zod'

// Bookings may only be made for tonight through 14 nights ahead — Madrid
// nights with the 06:00 rollover (lib/utils.resolveBookingDate), the same rule
// as every other booking route.
function isWithinBookingWindow(value: string): boolean {
  return resolveBookingDate(value) === value
}

const createBookingSchema = z.object({
  club_id:           z.string().uuid(),
  booking_type:      z.enum(['general', 'vip']),
  party_size:        z.number().int().min(1).max(20),
  booking_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isWithinBookingWindow, {
                       message: 'Pick a night in the next two weeks.',
                     }),
  arrival_window:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  payment_method_id: z.string().min(1),
  /** What the client showed the guest, in euros. Optional for older clients. */
  expected_total:    z.number().positive().optional(),
})

// GET /api/bookings — user's own booking history + guest list signups + ticket orders
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createAuthedClient()

  const [bookingsRes, signupsRes, ticketsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select(`
        id, booking_type, party_size, booking_date, arrival_window,
        status, total_amount, qr_code_token, created_at,
        clubs (id, name, cover_image_url, address, neighborhood, opening_hours)
      `)
      .eq('user_id', user!.id)
      .order('booking_date', { ascending: false }),

    supabase
      .from('guest_list_signups')
      .select(`
        id, full_name, party_size, status, tier, checked_in, created_at,
        guest_lists (id, event_name, event_date, cutoff_time, free_entry_label,
          clubs (id, name, neighborhood)
        )
      `)
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false }),

    supabase
      .from('ticket_orders')
      .select(`
        id, event_name, venue_name, venue_place_id, event_date,
        quantity, base_price_cents, markup_cents, total_cents,
        status, platform, platform_event_id, created_at
      `)
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false }),
  ])

  if (bookingsRes.error) return err(bookingsRes.error.message)
  return ok({
    bookings:      bookingsRes.data ?? [],
    guest_signups: signupsRes.data ?? [],
    ticket_orders: ticketsRes.data ?? [],
  })
}

// POST /api/bookings — create a new booking + Stripe payment
//
// Order matters, because money moves in the middle:
//   1. a recent identical booking is returned instead of charging again
//      (a double tap, or a client retry after a dropped response);
//   2. the booking row is written FIRST, as 'pending';
//   3. the PaymentIntent is created with an idempotency key tied to that row
//      and the row's id in its metadata — so a retry can't charge twice, and
//      if step 4 never happens the webhook still confirms the row;
//   4. the row is confirmed (or deleted if the charge failed).
// It used to charge first and insert after: an insert failure left the guest
// charged with no booking, and every tap was a fresh charge.
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body   = await request.json().catch(() => ({}))
  const parsed = createBookingSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid booking')

  const supabase = await createAuthedClient()
  const admin    = await createServiceClient()

  // Fetch club to get pricing
  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .select('id, name, general_entry_price, vip_table_min_spend, is_active, is_partner')
    .eq('id', parsed.data.club_id)
    .single()

  if (clubError || !club || !club.is_active) return err('Club not found', 404)

  // Fetch user membership tier for discount calculation
  const { data: profile } = await supabase
    .from('users')
    .select('membership_tier, stripe_customer_id')
    .eq('id', user!.id)
    .single()

  const unitPrice =
    parsed.data.booking_type === 'vip'
      ? (club.vip_table_min_spend ?? 0)
      : (club.general_entry_price ?? 0)

  if (unitPrice === 0) return err('Pricing not available for this club', 400)

  // Benefits only apply at partner clubs
  const { total, platformFee } = calculateOrderTotal(
    unitPrice,
    parsed.data.party_size,
    profile?.membership_tier ?? 'free',
    club.is_partner ?? false,
  )

  // Never charge more than the guest was shown. The Apple Pay sheet / card
  // form displays the client's figure; if the club's price rose since the
  // page loaded, refuse rather than take more. (Less — a member discount —
  // is fine.) Older clients don't send it.
  const expected = parsed.data.expected_total
  if (expected != null && total > expected + 0.005) {
    return err('The price for this night has changed. Check the new price and try again.', 409)
  }

  // 1. Double tap / retry → the booking already made, not a second charge.
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: recent } = await admin
    .from('bookings')
    .select(`*, clubs(id, name, cover_image_url, address)`)
    .eq('user_id', user!.id).eq('club_id', parsed.data.club_id)
    .eq('booking_date', parsed.data.booking_date).eq('booking_type', parsed.data.booking_type)
    .in('status', ['confirmed', 'pending'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  if (recent?.status === 'confirmed') return ok(recent)
  if (recent?.status === 'pending') {
    return err('Your payment for this night is still going through. Check Tickets in a moment before trying again.', 409)
  }

  const qrToken = generateQRToken()

  // 2. The row first.
  const { data: pending, error: pendingErr } = await admin
    .from('bookings')
    .insert({
      user_id:        user!.id,
      club_id:        parsed.data.club_id,
      booking_type:   parsed.data.booking_type,
      party_size:     parsed.data.party_size,
      booking_date:   parsed.data.booking_date,
      arrival_window: parsed.data.arrival_window,
      status:         'pending',
      unit_price:     unitPrice,
      total_amount:   total,
      platform_fee:   platformFee,
      qr_code_token:  qrToken,
    })
    .select('id')
    .single()
  if (pendingErr || !pending) {
    console.error('[bookings] pending insert:', pendingErr?.message)
    return err('We couldn’t start your booking. You haven’t been charged.', 500)
  }

  // 3. The charge, tied to the row.
  let paymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(total * 100), // euros → cents
      currency: 'eur',
      customer: profile?.stripe_customer_id ?? undefined,
      payment_method: parsed.data.payment_method_id,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        club_id:      parsed.data.club_id,
        user_id:      user!.id,
        booking_type: parsed.data.booking_type,
        qr_token:     qrToken,
        booking_id:   pending.id,
      },
    }, { idempotencyKey: `booking-${pending.id}` })
  } catch (stripeErr: unknown) {
    await admin.from('bookings').delete().eq('id', pending.id).eq('status', 'pending')
    // A card error's message is written for the cardholder ("Your card was
    // declined."); anything else is ours and stays in the log.
    const e = stripeErr as { type?: string; message?: string }
    console.error('[bookings] stripe:', e?.type, e?.message)
    return err(e?.type === 'StripeCardError' && e.message ? e.message : 'The payment didn’t go through. You haven’t been charged.', 402)
  }

  if (paymentIntent.status !== 'succeeded') {
    // requires_action (3-D Secure) can't be completed in this flow
    // (allow_redirects: 'never'). Cancel it so nothing is left half-paid.
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {})
    await admin.from('bookings').delete().eq('id', pending.id).eq('status', 'pending')
    return err('Your bank needs to verify this payment, which isn’t supported here yet. Try another card or Apple Pay.', 402)
  }

  // 4. Confirm. If this write fails the guest has still paid: the
  // payment_intent.succeeded webhook confirms the row by booking_id.
  const { data: booking, error: bookingError } = await admin
    .from('bookings')
    .update({ status: 'confirmed', stripe_payment_intent_id: paymentIntent.id })
    .eq('id', pending.id)
    .eq('status', 'pending')   // never re-confirm a booking cancelled mid-payment
    .select(`*, clubs(id, name, cover_image_url, address)`)
    .maybeSingle()

  if (!bookingError && !booking) {
    // Cancelled while the charge was in flight: give the money back in full.
    await stripe.refunds.create({ payment_intent: paymentIntent.id }).catch(e =>
      console.error('[bookings] refund of cancelled-in-flight booking failed:', pending.id, e?.message))
    return err('This booking was cancelled while paying. You’ve been refunded in full.', 409)
  }
  if (bookingError || !booking) {
    console.error('[bookings] confirm after charge:', pending.id, bookingError?.message)
    return err('Payment received — your booking is being saved and will appear in Tickets shortly. Don’t pay again.', 502)
  }
  return ok(booking, 201)
}
