import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err, generateQRToken } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe, calculateOrderTotal } from '@/lib/stripe'
import { z } from 'zod'

// Bookings may only be made for today through 14 days ahead (server-side guard
// mirroring the WhenPlanner cap). Compared in UTC date terms — generous by a day
// across timezones, which is acceptable for a "no further than 2 weeks" rule.
function isWithinBookingWindow(value: string): boolean {
  const picked = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(picked.getTime())) return false
  const today = new Date()
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const diffDays = Math.floor((picked.getTime() - todayUTC) / 86_400_000)
  return diffDays >= 0 && diffDays <= 14
}

const createBookingSchema = z.object({
  club_id:           z.string().uuid(),
  booking_type:      z.enum(['general', 'vip']),
  party_size:        z.number().int().min(1).max(20),
  booking_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isWithinBookingWindow, {
                       message: 'Booking date must be today or within the next 14 days',
                     }),
  arrival_window:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  payment_method_id: z.string().min(1),
})

// GET /api/bookings — user's own booking history + guest list signups + ticket orders
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const [bookingsRes, signupsRes, ticketsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select(`
        id, booking_type, party_size, booking_date, arrival_window,
        status, total_amount, qr_code_token, created_at,
        clubs (id, name, cover_image_url, address, neighborhood)
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
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body   = await request.json()
  const parsed = createBookingSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const supabase = await createClient()

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
  const { total, discount, platformFee } = calculateOrderTotal(
    unitPrice,
    parsed.data.party_size,
    profile?.membership_tier ?? 'free',
    club.is_partner ?? false,
  )

  const qrToken = generateQRToken()

  // Create Stripe PaymentIntent and immediately confirm
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
      },
    })
  } catch (stripeErr: any) {
    return err(stripeErr.message ?? 'Payment failed', 402)
  }

  const isConfirmed = paymentIntent.status === 'succeeded'

  // Persist booking row
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      user_id:                   user!.id,
      club_id:                   parsed.data.club_id,
      booking_type:              parsed.data.booking_type,
      party_size:                parsed.data.party_size,
      booking_date:              parsed.data.booking_date,
      arrival_window:            parsed.data.arrival_window,
      status:                    isConfirmed ? 'confirmed' : 'pending',
      stripe_payment_intent_id:  paymentIntent.id,
      unit_price:                unitPrice,
      total_amount:              total,
      platform_fee:              platformFee,
      qr_code_token:             qrToken,
    })
    .select(`*, clubs(id, name, cover_image_url, address)`)
    .single()

  if (bookingError) return err(bookingError.message)
  return ok(booking, 201)
}
