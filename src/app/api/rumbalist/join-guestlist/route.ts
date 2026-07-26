import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err, resolveBookingDate } from '@/lib/utils'
import { generateReferenceCode } from '@/lib/rumbalist-reference'
import { offerRunsOn, supplyingBrandId } from '@/lib/partner'

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

  // Native sends the night picked in the When planner; when absent (web),
  // keep the legacy default of tomorrow.
  const bookingDate = resolveBookingDate(body.booking_date)
  if (!bookingDate) return err('booking_date must be today or within the next 14 days')

  const supabase = await createServiceClient()

  // The supplier can turn off a single night of an otherwise-running offer.
  // Client-side filtering is presentation; this is the enforcement, so a stale
  // or hand-rolled client can't put someone on a list that isn't happening.
  if (!(await offerRunsOn(supabase, clubId, 'free_guestlist', bookingDate))) {
    return err('This guestlist isn\'t running on that night.', 409)
  }

  // 1. Booking row — retry on the (vanishingly rare) reference-code collision.
  //    Postgres unique violation = code 23505. Five attempts is plenty since
  //    each attempt re-rolls 8 chars from a 36-char alphabet.
  // Which supplier's list this is, so the ticket brands itself correctly.
  // Null when it can't be certain (see supplyingBrandId) — never a guess.
  const brandId = await supplyingBrandId(supabase, clubId, 'free_guestlist', bookingDate)

  // Capacity: refuse once the night's issued tickets reach the offer's cap.
  // Scoped to the supplying brand's offer for this club+kind. Best-effort
  // (a rare concurrent join can nudge past the cap); a missing capacity column
  // or no cap set means unlimited, so this never blocks a normal guestlist.
  if (brandId) {
    const { data: offerRow } = await supabase
      .from('partner_offers')
      .select('capacity')
      .eq('club_id', clubId).eq('kind', 'free_guestlist').eq('brand_id', brandId)
      .maybeSingle()
    const cap = (offerRow as { capacity?: number | null } | null)?.capacity ?? null
    if (cap != null && cap > 0) {
      // Count tickets already issued for this brand's list that night. Falls
      // back to all guestlist joins at the venue if brand attribution isn't
      // on bookings yet (pre-migration).
      const base = () => supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', clubId).eq('booking_date', bookingDate)
        .eq('booking_type', 'general').eq('status', 'confirmed')
      let { count, error: cErr } = await base().eq('brand_id', brandId)
      if (cErr && /brand_id/.test(cErr.message ?? '')) {
        ({ count } = await base())
      }
      if ((count ?? 0) >= cap) {
        return err('This guestlist is full for that night.', 409)
      }
    }
  }

  let booking: any = null
  let bookingErr: any = null
  let withBrand = true
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferenceCode()
    const res  = await supabase
      .from('bookings')
      .insert({
        user_id:        user!.id,
        club_id:        clubId,
        booking_type:   'general',  // 'free_guestlist' violates the bookings CHECK constraint
        party_size:     1,
        booking_date:   bookingDate,
        status:         'confirmed',
        unit_price:     0,
        total_amount:   0,
        platform_fee:   0,
        qr_code_token:  code,
        ...(withBrand && brandId ? { brand_id: brandId } : {}),
      })
      .select('*')
      .single()
    booking    = res.data
    bookingErr = res.error
    if (!bookingErr) break
    // brand_id migration not applied yet → drop the column and keep going.
    // Attribution is a nicety; never fail someone's guestlist over it.
    if (/brand_id/.test(bookingErr.message ?? '') && withBrand) { withBrand = false; continue }
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
      event_date:        bookingDate,
      booking_id:        booking.id,
    })
  } catch (auditErr) {
    console.error('rumbalist_purchases insert failed (non-fatal):', auditErr)
  }

  return ok(booking)
}
