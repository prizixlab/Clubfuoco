import { createAuthedClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { nightWindowFor } from '@/lib/hours'
import { z } from 'zod'

// ── POST /api/bookings/:id/signals ────────────────────────────────────────────
//
// The native app posts attendance signals as the user moves through their night
// — passive geo presence, opening the pass near the venue, the explicit
// "I'm here" check-in, and the post-entry "did you get in?" answer.
//
// The DB trigger on booking_attendance_signals rolls these into a status on
// the booking row; this route just validates + writes the signal.

const CHECKIN_RADIUS_M = 250        // strictest gate: explicit "I'm here"
const PASSIVE_RADIUS_M = 400        // looser gate for passive signals
// Presence window = club opening → closing for that night (or cutoff + 3h for
// time-boxed invitations like rumba list). Computed per-booking below.
const POST_ENTRY_WINDOW_HOURS_AFTER = 14 * 24  // post-entry / review answers: up to 2 weeks later

const userKinds = ['user_checkin','geo_presence','pass_viewed','post_entry_got_in','post_entry_issue','morning_after_opened'] as const
type UserKind = typeof userKinds[number]

const bodySchema = z.object({
  kind:       z.enum(userKinds),
  lat:        z.number().finite().optional(),
  lng:        z.number().finite().optional(),
  // post-entry only — "did_not_go" surfaces a no_show; other reasons feed dispute review.
  reason:     z.enum(['denied','not_on_list','arrived_late','dress_code','at_capacity','did_not_go','other']).optional(),
  note:       z.string().max(500).optional(),
}).strict()

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function minsToISO(date: string, mins: number, addDay: boolean): Date {
  // booking_date is a calendar date in the venue's TZ; without a per-club tz
  // we approximate with UTC. Real-world misalignment is absorbed by the post
  // window and the radius gate.
  const base = new Date(`${date}T00:00:00Z`).getTime()
  return new Date(base + (mins * 60_000) + (addDay ? 86_400_000 : 0))
}

function bookingWindow(
  date: string,
  openingHours: string[] | null,
  cutoffTime: string | null,
  kind: UserKind,
): { earliest: Date; latest: Date } {
  const { openMin, closeMin, closesNextDay } = nightWindowFor(openingHours, date)
  const earliest = minsToISO(date, openMin, false)
  // Default end = club closing. Invitation-limited bookings (rumba list etc.)
  // collapse to cutoff + 3h, since the door closes at the cutoff and there's
  // no point keeping a presence signal open all night.
  let endOfPresence: Date
  if (cutoffTime) {
    const [ch, cm] = cutoffTime.split(':').map(Number)
    const cutMin = ch * 60 + (cm || 0)
    // Cutoffs land after midnight (e.g. 01:30) almost always — push to next day
    // when they sit before opening.
    const cutNextDay = cutMin < openMin
    endOfPresence = new Date(minsToISO(date, cutMin, cutNextDay).getTime() + 3 * 3_600_000)
  } else {
    endOfPresence = minsToISO(date, closeMin, closesNextDay)
  }
  // Post-entry answers AND the morning-after prompt land after the night —
  // keep the window open for up to two weeks.
  if (kind === 'post_entry_got_in' || kind === 'post_entry_issue' || kind === 'morning_after_opened') {
    return {
      earliest,
      latest: new Date(endOfPresence.getTime() + (POST_ENTRY_WINDOW_HOURS_AFTER - 0) * 3_600_000),
    }
  }
  return { earliest, latest: endOfPresence }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'invalid body')
  const body = parsed.data

  const authed = await createAuthedClient()
  const { data: booking, error: bErr } = await authed
    .from('bookings')
    .select('id, user_id, club_id, booking_date, arrival_window, status, clubs(lat, lng, opening_hours)')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single<{
      id: string; user_id: string; club_id: string;
      booking_date: string; arrival_window: string | null; status: string;
      clubs: { lat: number | null; lng: number | null; opening_hours: string[] | null } | null
    }>()

  if (bErr || !booking) return err('Booking not found', 404)
  if (booking.status === 'cancelled') return err('Booking cancelled', 409)

  // Cutoff for time-boxed invitations (rumba list etc.) is not on bookings yet —
  // when guest-list signups gain attendance signals, this is where it plugs in.
  const cutoffTime: string | null = null
  const { earliest, latest } = bookingWindow(
    booking.booking_date,
    booking.clubs?.opening_hours ?? null,
    cutoffTime,
    body.kind,
  )
  const now = new Date()
  if (now < earliest || now > latest) return err('Outside booking window', 409)

  // Distance gate for location-bearing signals.
  let distance_m: number | null = null
  if (body.lat != null && body.lng != null) {
    if (booking.clubs?.lat == null || booking.clubs?.lng == null) {
      return err('Venue location unavailable', 409)
    }
    distance_m = Math.round(haversineM(body.lat, body.lng, booking.clubs.lat, booking.clubs.lng))
    const cap = body.kind === 'user_checkin' ? CHECKIN_RADIUS_M : PASSIVE_RADIUS_M
    if (distance_m > cap) return err(`Too far from venue (${distance_m}m)`, 409)
  } else if (body.kind === 'user_checkin') {
    return err('Location required for check-in', 400)
  }

  // Dedupe noisy passive signals within 10 minutes per (booking, kind).
  if (body.kind === 'geo_presence' || body.kind === 'pass_viewed') {
    const since = new Date(now.getTime() - 10 * 60_000).toISOString()
    const { data: recent } = await authed
      .from('booking_attendance_signals')
      .select('id')
      .eq('booking_id', booking.id)
      .eq('kind', body.kind)
      .gte('created_at', since)
      .limit(1)
    if (recent?.length) return ok({ deduped: true })
  }

  // Service client — RLS bypass; user ownership already enforced via authed read above.
  const svc = await createServiceClient()
  const metadata: Record<string, unknown> = {}
  if (body.reason) metadata.reason = body.reason
  if (body.note)   metadata.note   = body.note

  const { error: insErr } = await svc.from('booking_attendance_signals').insert({
    booking_id: booking.id,
    user_id:    user!.id,
    club_id:    booking.club_id,
    kind:       body.kind as UserKind,
    source:     'ios',
    lat:        body.lat ?? null,
    lng:        body.lng ?? null,
    distance_m,
    metadata,
  })
  if (insErr) return err(insErr.message, 500)

  // Return the rolled-up status so the client can update its UI immediately.
  const { data: updated } = await svc
    .from('bookings')
    .select('attendance_status, attendance_confidence, checked_in_at, checked_in_distance_m')
    .eq('id', booking.id)
    .single()

  return ok({
    logged: body.kind,
    distance_m,
    attendance: updated ?? null,
  })
}
