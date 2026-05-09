import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { generateQRToken } from '@/lib/utils'

// Only available in development
export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  // Try to grab any existing club so the join works; fall back to null
  const { data: club } = await supabase
    .from('clubs')
    .select('id, name')
    .limit(1)
    .maybeSingle()

  // Tomorrow's date as booking date
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const bookingDate = tomorrow.toISOString().slice(0, 10)

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
