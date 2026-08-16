import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { generateQRToken } from '@/lib/utils'

// Owner emails allowed to seed test bookings in production, as a comma-
// separated TEST_BOOKING_EMAILS. Kept out of the source because this repo is
// public and a hardcoded address here names exactly whose account to go after.
//
// Unset means nobody in production, which is the safe way to fail: the endpoint
// still works in local development, where NODE_ENV gates it instead.
const TEST_BOOKING_ALLOWLIST = (process.env.TEST_BOOKING_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export async function POST() {
  const { user, response } = await requireAuth()
  if (response) return response

  const isDev      = process.env.NODE_ENV === 'development'
  const userEmail  = user?.email?.toLowerCase() ?? ''
  const isAllowed  = TEST_BOOKING_ALLOWLIST.includes(userEmail)

  if (!isDev && !isAllowed) {
    return NextResponse.json({ error: 'Not available' }, { status: 403 })
  }

  // Service client — bypasses RLS so the booking insert can't be blocked
  // on a native (cookie-less) request. User is verified by requireAuth().
  const supabase = await createServiceClient()

  // Try to grab any existing club so the join works; fall back to null
  const { data: club } = await supabase
    .from('clubs')
    .select('id, name')
    .limit(1)
    .maybeSingle()

  // Booking dated 2 days ago — inside the survey window (yesterday–7 days
  // ago) so the test booking is immediately reviewable. A future date would
  // never surface in the "How was last night?" review prompt.
  const past = new Date()
  past.setDate(past.getDate() - 2)
  const bookingDate = past.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id:      user!.id,
      club_id:      club?.id ?? null,
      booking_type: 'general',
      party_size:   2,
      booking_date: bookingDate,
      status:       'confirmed',
      unit_price:   20,
      total_amount: 22,   // 20 base + 10% fee
      platform_fee: 2,
      qr_code_token: generateQRToken(),
      stripe_payment_intent_id: null,
    })
    .select(`*, clubs(id, name, cover_image_url, address, neighborhood)`)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
