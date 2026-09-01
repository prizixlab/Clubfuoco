import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// POST   /api/events/[id]/reserve — reserve a spot on one of our events.
// DELETE /api/events/[id]/reserve — cancel that reservation.
//
// A reservation IS a booking. It writes an ordinary `bookings` row, so the
// spot inherits everything a booking already has — the QR pass, the Tickets
// tab, arrival check-in, Apple Wallet, and the post-night venue survey (which
// reads `bookings` and keys `booking_surveys` off booking_id). Nothing here
// reimplements any of that.
//
// It ALSO writes a `promoter_guests` row against the night's allocation. That
// is the door's list, and it is what the capacity trigger counts — the booking
// is the guest's record of the night, the guest row is the venue's. Writing
// only the booking would let a room sell past its capacity, because nothing
// counts bookings against `total_capacity`.

/** The house promoter — owns allocations for events we run ourselves. */
const HOUSE_PROMOTER_ID = '11d06f61-ec38-4c63-8b46-c3b0fbc53c7b'

function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Random token for an allocation. Allocations require one even when nobody
 *  will ever follow it — a feed reservation has no invite link. */
function token(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

// GET /api/events/[id]/reserve — my standing on this night.
//
// The detail screen needs this on load: without it a returning guest sees
// "Reserve a spot" on a night they are already on, and taps it expecting
// something to happen. `full` is answered here too, because remaining spots
// live on the allocation and the public feed deliberately does not carry them.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const sb = await createServiceClient()

  const { data: event } = await sb
    .from('v_events_feed')
    .select('id, club_id, night_date, total_capacity')
    .eq('id', id)
    .maybeSingle()

  if (!event) return err('That event is not open for reservations', 404)

  // Capacity is a property of the night, not of the caller, so it is computed
  // before auth — a signed-out guest still needs to know the room is full.
  const { data: allocs } = await sb
    .from('promoter_allocations')
    .select('id, spots')
    .eq('night_id', id)

  let full = false
  const allocIds = (allocs ?? []).map(a => a.id)
  if (allocIds.length > 0) {
    const spots = (allocs ?? []).reduce((n, a) => n + (a.spots ?? 0), 0)
    const { count } = await sb
      .from('promoter_guests')
      .select('id', { count: 'exact', head: true })
      .in('allocation_id', allocIds)
    full = (count ?? 0) >= spots
  }

  // Guests get the capacity answer and nothing personal.
  const { user } = await requireAuth()
  if (!user) return ok({ reserved: false, full, booking_id: null })

  const { data: booking } = await sb
    .from('bookings')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('club_id', event.club_id)
    .eq('booking_date', event.night_date)
    .neq('status', 'cancelled')
    .maybeSingle()

  return ok({ reserved: !!booking, full, booking_id: booking?.id ?? null })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const { id } = await ctx.params
  const sb = await createServiceClient()

  const body = await req.json().catch(() => ({}))
  // Party size counts the guest themselves, so plus-ones is one less.
  const partySize = Math.max(1, Math.min(10, Number(body.party_size) || 1))
  const locationConsent =
    typeof body.location_consent === 'boolean' ? body.location_consent : null

  // Read through the feed view, not the table: that is the one place the guest
  // gate lives (published, approved, public, not past), so a reservation can
  // never be made against a night a guest is not allowed to see.
  const { data: event, error: evErr } = await sb
    .from('v_events_feed')
    .select('id, club_id, night_date, title, total_capacity, max_plus_ones, price_cents, is_house, hosts')
    .eq('id', id)
    .maybeSingle()

  if (evErr) return err(evErr.message, 500)
  if (!event) return err('That event is not open for reservations', 404)

  // `bookings.club_id` is NOT NULL, so an event at a free-text address has
  // nowhere to hang a booking. Refused explicitly rather than failing on the
  // insert with a constraint error nobody can act on.
  if (!event.club_id) {
    return err('This event is not at one of our venues, so it cannot be reserved yet', 409)
  }

  // Paid nights go through Stripe, not through here. The house-free constraint
  // means this can only ever trigger on a promoter's priced night.
  if ((event.price_cents ?? 0) > 0) {
    return err('This event is ticketed — reserving is only for free entry', 409)
  }

  const maxPlus = event.max_plus_ones ?? 0
  if (partySize - 1 > maxPlus) {
    return err(`You can bring at most ${maxPlus} guest${maxPlus === 1 ? '' : 's'}`, 400)
  }

  // Already reserved? Idempotent — return the existing booking rather than
  // minting a second one for the same night.
  const { data: existing } = await sb
    .from('bookings')
    .select('id, status, qr_code_token')
    .eq('user_id', user!.id)
    .eq('club_id', event.club_id)
    .eq('booking_date', event.night_date)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (existing) return ok({ booking_id: existing.id, already: true })

  // ── Capacity ───────────────────────────────────────────────────────────────
  // Counted off the door list (promoter_guests via allocations), which is the
  // only place spots are actually tracked. Bookings are not counted against a
  // room by anything else in the system.
  const { data: allocs } = await sb
    .from('promoter_allocations')
    .select('id, spots, promoter_id')
    .eq('night_id', id)

  // Prefer the house list on a house night; otherwise take whatever list the
  // promoter has open.
  let allocation = (allocs ?? []).find(a => a.promoter_id === HOUSE_PROMOTER_ID) ?? (allocs ?? [])[0]

  if (!allocation) {
    // First reservation on a house night: open the list, sized to the room.
    if (!event.is_house) {
      return err('This event has no guest list open', 409)
    }
    const { data: made, error: allocErr } = await sb
      .from('promoter_allocations')
      .insert({
        night_id: id,
        promoter_id: HOUSE_PROMOTER_ID,
        spots: event.total_capacity ?? 100,
        invite_token: token(),
        group_visible: false,
      })
      .select('id, spots, promoter_id')
      .single()
    if (allocErr) return err(allocErr.message, 500)
    allocation = made
  }

  const { count: taken } = await sb
    .from('promoter_guests')
    .select('id', { count: 'exact', head: true })
    .eq('allocation_id', allocation.id)

  if ((taken ?? 0) + partySize > (allocation.spots ?? 0)) {
    return err('This night is full', 409)
  }

  // ── The guest's record ─────────────────────────────────────────────────────
  const { data: profile } = await sb
    .from('users')
    .select('full_name')
    .eq('id', user!.id)
    .maybeSingle()

  // Stamp the hosting brand so the Apple Wallet pass carries its name, colour
  // and logo — `/api/bookings/[id]/wallet` reads `brand_id` for exactly that.
  // The first host with a real partner_brands id wins; a free-text host has
  // nothing to style from. House events fall back to the Club Fuoco brand.
  const hostId = Array.isArray(event.hosts)
    ? (event.hosts as { id?: string }[]).find(h => h?.id)?.id ?? null
    : null
  let brandId = hostId
  if (!brandId && event.is_house) {
    const { data: house } = await sb
      .from('partner_brands')
      .select('id')
      .eq('key', 'clubfuoco')
      .maybeSingle()
    brandId = (house?.id as string) ?? null
  }

  const { data: booking, error: bookErr } = await sb
    .from('bookings')
    .insert({
      user_id: user!.id,
      club_id: event.club_id,
      booking_date: event.night_date,
      booking_type: 'general',
      party_size: partySize,
      brand_id: brandId,
      // Free entry, so nothing is owed and there is nothing to confirm later.
      status: 'confirmed',
    })
    .select('id, qr_code_token')
    .single()

  if (bookErr) return err(bookErr.message, 500)

  // ── The door's list ────────────────────────────────────────────────────────
  // Written after the booking so a failure here cannot leave a guest on the
  // door list with no pass of their own. If this insert fails the booking is
  // rolled back by hand — there is no transaction across PostgREST calls.
  const { error: guestErr } = await sb.from('promoter_guests').insert({
    allocation_id: allocation.id,
    full_name: (profile?.full_name as string) ?? 'Guest',
    plus_ones: partySize - 1,
    claimed_by_user: user!.id,
    created_via_invite: false,
    location_consent: locationConsent,
    payment_status: 'free',
  })

  if (guestErr) {
    await sb.from('bookings').delete().eq('id', booking.id)
    return err(guestErr.message, 500)
  }

  return ok({ booking_id: booking.id, qr_code_token: booking.qr_code_token, party_size: partySize })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const { id } = await ctx.params
  const sb = await createServiceClient()

  const { data: event } = await sb
    .from('promoter_nights')
    .select('id, club_id, night_date')
    .eq('id', id)
    .maybeSingle()

  if (!event?.club_id) return err('No such event', 404)
  if (event.night_date < todayMadrid()) return err('That night has already passed', 409)

  // Cancel rather than delete: a booking is a record, and the surveys window
  // and any dispute both read past bookings.
  const { data: booking } = await sb
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('user_id', user!.id)
    .eq('club_id', event.club_id)
    .eq('booking_date', event.night_date)
    .neq('status', 'cancelled')
    .select('id')
    .maybeSingle()

  // The door list, by contrast, is deleted — a cancelled guest must not appear
  // on it at all, and it carries no history worth keeping.
  const { data: allocs } = await sb
    .from('promoter_allocations')
    .select('id')
    .eq('night_id', id)

  const allocIds = (allocs ?? []).map(a => a.id)
  if (allocIds.length > 0) {
    await sb
      .from('promoter_guests')
      .delete()
      .in('allocation_id', allocIds)
      .eq('claimed_by_user', user!.id)
  }

  return ok({ cancelled: true, booking_id: booking?.id ?? null })
}
