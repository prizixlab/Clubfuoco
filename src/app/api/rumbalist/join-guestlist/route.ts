import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { generateReferenceCode } from '@/lib/rumbalist-reference'

// Add the authenticated user to a Rumbalist free guestlist for a club.
// Writes two rows:
//   1. `bookings` (booking_type: 'general') — so the user's Tickets tab shows it
//   2. `rumbalist_purchases` — the audit feed handed back to Rumbalist
export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  if (!body.club_id) return err('club_id is required')
  const clubId      = String(body.club_id)
  const venueName   = body.venue_name ? String(body.venue_name) : null
  const productName = body.product_name ? String(body.product_name) : 'Free Guestlist'

  const supabase = await createServiceClient()
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)

  // 1. Booking row — retry on the (vanishingly rare) reference-code collision.
  //    Postgres unique violation = code 23505. Five attempts is plenty since
  //    each attempt re-rolls 8 chars from a 36-char alphabet.
  let booking: any = null
  let bookingErr: any = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferenceCode()
    const res  = await supabase
      .from('bookings')
      .insert({
        user_id:        user!.id,
        club_id:        clubId,
        booking_type:   'general',  // 'free_guestlist' violates the bookings CHECK constraint
        party_size:     1,
        booking_date:   tomorrow,
        status:         'confirmed',
        unit_price:     0,
        total_amount:   0,
        platform_fee:   0,
        qr_code_token:  code,
      })
      .select('*')
      .single()
    booking    = res.data
    bookingErr = res.error
    if (!bookingErr) break
    if (bookingErr.code !== '23505') break  // not a unique conflict — give up
  }
  if (bookingErr) return err(bookingErr.message)

  // 2. Rumbalist purchase audit row — failure here is non-fatal so the user
  //    still gets their ticket if the audit table is missing. Logged for fixup.
  try {
    const { data: profile } = await supabase
      .from('users')
      .select('full_name, email, phone')
      .eq('id', user!.id)
      .single()
    await supabase.from('rumbalist_purchases').insert({
      user_id:           user!.id,
      full_name:         profile?.full_name ?? null,
      email:             profile?.email ?? null,
      phone:             profile?.phone ?? null,
      venue_id:          clubId,
      venue_name:        venueName ?? 'Unknown venue',
      product_name:      productName,
      product_kind:      'free_guestlist',
      price_eur:         0,
      event_date:        tomorrow,
      booking_id:        booking.id,
    })
  } catch (auditErr) {
    console.error('rumbalist_purchases insert failed (non-fatal):', auditErr)
  }

  return ok(booking)
}
