import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe, PLATFORM_FEE_PERCENT } from '@/lib/stripe'

// POST — club creates a Stripe Checkout session to pay a DJ
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
  if (!staff) return err('Not linked to a club')

  const { booking_type, booking_id, fee_cents } = await request.json()
  if (!booking_type || !booking_id || !fee_cents) return err('Missing required fields')
  if (fee_cents < 100) return err('Minimum fee is €1')

  const platformFeeCents = Math.round(fee_cents * PLATFORM_FEE_PERCENT)
  const netCents = fee_cents - platformFeeCents

  // Resolve DJ user id and booking details
  let djId: string | null = null
  let djUserId: string | null = null
  let bookingLabel = ''

  if (booking_type === 'request') {
    const { data } = await supabase
      .from('gig_requests')
      .select('dj_id, event_name, dj_profiles(user_id)')
      .eq('id', booking_id)
      .eq('club_id', staff.club_id)
      .single()
    if (!data) return err('Request not found')
    djId = data.dj_id
    djUserId = (data as any).dj_profiles?.user_id
    bookingLabel = (data as any).event_name
  } else if (booking_type === 'application') {
    const { data } = await supabase
      .from('gig_applications')
      .select('dj_id, dj_profiles(user_id), gig_openings(title)')
      .eq('id', booking_id)
      .single()
    if (!data) return err('Application not found')
    djId = data.dj_id
    djUserId = (data as any).dj_profiles?.user_id
    bookingLabel = (data as any).gig_openings?.title ?? 'Gig'
  } else {
    return err('Invalid booking_type')
  }

  const { data: club } = await supabase.from('clubs').select('name').eq('id', staff.club_id).single()
  const origin = request.headers.get('origin') ?? 'http://localhost:3000'

  // Create Stripe Checkout session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: fee_cents,
        product_data: {
          name: `DJ Booking: ${bookingLabel}`,
          description: `Booking via Club Fuoco — ${club?.name ?? 'Club'}`,
        },
      },
      quantity: 1,
    }],
    metadata: {
      booking_type,
      booking_id,
      club_id: staff.club_id,
      dj_id: djId ?? '',
      dj_user_id: djUserId ?? '',
      gross_cents: String(fee_cents),
      platform_fee_cents: String(platformFeeCents),
      net_cents: String(netCents),
    },
    success_url: `${origin}/club-dashboard?payment=success`,
    cancel_url: `${origin}/club-dashboard?payment=cancelled`,
  })

  // Record pending payment
  await supabase.from('gig_payments').insert({
    booking_type,
    booking_id,
    club_id: staff.club_id,
    dj_id: djId,
    gross_cents: fee_cents,
    platform_fee_cents: platformFeeCents,
    net_cents: netCents,
    stripe_session_id: session.id,
    status: 'pending',
  })

  return ok({ url: session.url })
}

// GET — DJ views their earnings, or club views payments sent
export async function GET(request: NextRequest) {
  const side = request.nextUrl.searchParams.get('side') ?? 'dj'
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  if (side === 'club') {
    const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
    if (!staff) return err('Not linked to a club')
    const { data, error } = await supabase
      .from('gig_payments')
      .select('*')
      .eq('club_id', staff.club_id)
      .order('created_at', { ascending: false })
    if (error) return err(error.message)
    return ok(data)
  }

  const { data: dj } = await supabase.from('dj_profiles').select('id').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')
  const { data, error } = await supabase
    .from('gig_payments')
    .select('*, clubs(name)')
    .eq('dj_id', dj.id)
    .order('created_at', { ascending: false })
  if (error) return err(error.message)
  return ok(data)
}
