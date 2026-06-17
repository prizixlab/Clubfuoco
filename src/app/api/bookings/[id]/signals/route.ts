import { createAuthedClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
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
const ARRIVAL_WINDOW_HOURS_BEFORE = 2          // earliest you can check in
const PRESENCE_WINDOW_HOURS_AFTER = 8          // location signals: tight, "are you actually there"
const POST_ENTRY_WINDOW_HOURS_AFTER = 14 * 24  // post-entry / review answers: up to 2 weeks later

const userKinds = ['user_checkin','geo_presence','pass_viewed','post_entry_got_in','post_entry_issue'] as const
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

function bookingWindow(
  date: string,
  arrival: string | null | undefined,
  kind: UserKind,
): { earliest: Date; latest: Date } {
  // arrival_window like "23:00"; if missing, treat as 22:00 local-ish.
  const [hh, mm] = (arrival ?? '22:00').split(':').map(Number)
  // booking_date is a calendar date in the venue's TZ; without a per-club tz
  // we approximate with UTC. The buffer windows soak up the offset.
  const base = new Date(`${date}T${String(hh).padStart(2,'0')}:${String(mm||0).padStart(2,'0')}:00Z`)
  const after = (kind === 'post_entry_got_in' || kind === 'post_entry_issue')
    ? POST_ENTRY_WINDOW_HOURS_AFTER
    : PRESENCE_WINDOW_HOURS_AFTER
  return {
    earliest: new Date(base.getTime() - ARRIVAL_WINDOW_HOURS_BEFORE * 3_600_000),
    latest:   new Date(base.getTime() + after * 3_600_000),
  }
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
    .select('id, user_id, club_id, booking_date, arrival_window, status, clubs(lat, lng)')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single<{
      id: string; user_id: string; club_id: string;
      booking_date: string; arrival_window: string | null; status: string;
      clubs: { lat: number | null; lng: number | null } | null
    }>()

  if (bErr || !booking) return err('Booking not found', 404)
  if (booking.status === 'cancelled') return err('Booking cancelled', 409)

  const { earliest, latest } = bookingWindow(booking.booking_date, booking.arrival_window, body.kind)
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
