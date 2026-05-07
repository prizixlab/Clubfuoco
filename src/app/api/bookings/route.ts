import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err, generateQRToken } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe, calculateOrderTotal } from '@/lib/stripe'
import { z } from 'zod'

const createBookingSchema = z.object({
  club_id:           z.string().uuid(),
  booking_type:      z.enum(['general', 'vip']),
  party_size:        z.number().int().min(1).max(20),
  booking_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arrival_window:    z.string().optional(),
  payment_method_id: z.string().min(1),
})

// GET /api/bookings — user's own booking history
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_type, party_size, booking_date, arrival_window,
      status, total_amount, qr_code_token, created_at,
      clubs (id, name, cover_image_url, address, neighborhood)
    `)
    .eq('user_id', user!.id)
    .order('booking_date', { ascending: false })

  if (error) return err(error.message)
  return ok(data)
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
    .select('id, name, general_entry_price, vip_table_min_spend, is_active')
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

  const { total, discount, platformFee } = calculateOrderTotal(
    unitPrice,
    parsed.data.party_size,
    profile?.membership_tier ?? 'free'
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
