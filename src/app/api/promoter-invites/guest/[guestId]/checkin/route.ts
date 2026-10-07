import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { NON_ADMITTING_PAYMENT } from '@/lib/refunds'

/**
 * Epoch ms for when a night's doors open, in Europe/Madrid.
 *
 * Returns NULL on anything it cannot parse — deliberately. The app's own
 * `activeNightBounds` falls back to `?? Date()` when the date string won't
 * parse, which means an unreadable date reads as "open right now, for the next
 * eight hours": the one value that fails open on the only question that
 * matters. A guard that cannot tell the time must refuse, not wave through.
 *
 * `22:00` is the nightlife default when a night records no opening time, the
 * same constant the client uses.
 */
function nightOpensAt(ymd: string, openTime: string | null | undefined): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  if (!day) return null
  const clock = /^(\d{2}):(\d{2})/.exec(openTime ?? '22:00') ?? ['', '22', '00']
  const [, y, mo, d] = day
  const hh = Number(clock[1]), mm = Number(clock[2])
  if (hh > 23 || mm > 59) return null

  // Madrid is UTC+1, or UTC+2 under CEST (last Sunday of March → last Sunday of
  // October). Derived from the date itself rather than assuming one offset, so
  // a night either side of the clock change is not shifted by an hour.
  const asUTC = Date.UTC(Number(y), Number(mo) - 1, Number(d), hh, mm)
  const offset = madridOffsetHours(new Date(asUTC))
  return asUTC - offset * 3600_000
}

function madridOffsetHours(at: Date): number {
  const year = at.getUTCFullYear()
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0))
    return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1)
  }
  const cestStart = lastSunday(2)   // last Sunday in March, 01:00 UTC
  const cestEnd = lastSunday(9)     // last Sunday in October, 01:00 UTC
  const t = at.getTime()
  return t >= cestStart && t < cestEnd ? 2 : 1
}

/**
 * Geofence-triggered auto check-in for an invite-claimed guest. Stamps
 * `promoter_guests.checked_in_at` once. The Fuoco consumer app calls this
 * from its background CLLocationManager region-entry handler.
 *
 * Auth: requires a logged-in Supabase user whose id matches
 * `promoter_guests.claimed_by_user` — prevents anyone from flipping someone
 * else's check-in. Service role under the hood (no RLS dependency) but we
 * verify the caller from the Bearer token ourselves.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params
  const sb = await createServiceClient()

  // Identify caller from Bearer
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp, error: userErr } = await sb.auth.getUser(bearer)
  if (userErr || !userResp.user) return err('Unauthorized', 401)
  const userId = userResp.user.id

  // Load guest, verify ownership
  const { data: guest, error: gErr } = await sb
    .from('promoter_guests')
    .select('id, claimed_by_user, checked_in_at, payment_status, allocation:promoter_allocations(night:promoter_nights(night_date, open_time))')
    .eq('id', guestId)
    .single()
  if (gErr || !guest) return err('Guest not found', 404)
  if (guest.claimed_by_user !== userId) return err('Forbidden', 403)
  // An unpaid hold (or a refunded / disputed spot) is not a guest. The door
  // refuses it; a geofence must not show it to the promoter as checked in.
  const pay = (guest as { payment_status?: string | null }).payment_status ?? 'free'
  if (NON_ADMITTING_PAYMENT.has(pay)) return err('This spot isn’t paid', 409)

  // Idempotent — first trigger wins
  if (guest.checked_in_at) {
    return ok({ checkedInAt: guest.checked_in_at, idempotent: true })
  }

  // The night has to actually be happening.
  //
  // This route took the client entirely on trust: any region-entry event
  // stamped a check-in, whatever the date. A guest who claims a spot for next
  // Saturday and then walks past the venue today was checked in on the spot,
  // and a single spurious CoreLocation callback burned the one chance to be
  // admitted. The client has its own window check, but a client gate is a
  // convenience — this is the enforcement.
  //
  // Window: 2h before doors through 8h after, matching activeNightBounds in
  // the app, with the same 22:00 nightlife default when a night sets no
  // opening time. Europe/Madrid, because the night belongs to the venue's day.
  const night = Array.isArray(guest.allocation)
    ? (guest.allocation[0] as { night?: unknown })?.night
    : (guest.allocation as { night?: unknown } | null)?.night
  const nightRow = (Array.isArray(night) ? night[0] : night) as
    { night_date?: string | null; open_time?: string | null } | null

  if (!nightRow?.night_date) return err('Night not found', 404)
  const opens = nightOpensAt(nightRow.night_date, nightRow.open_time)
  if (!opens) return err('Night not found', 404)

  const now = Date.now()
  if (now < opens - 2 * 3600_000 || now > opens + 8 * 3600_000) {
    return err('This night is not open for check-in yet', 409)
  }

  const stamp = new Date().toISOString()
  // A geofence-triggered check-in is itself proof the guest shared location,
  // so stamp consent alongside, and say where the check-in came from — a row
  // carrying a time and nothing else cannot be told apart from a door scan or
  // a promoter tapping a name. Drift-defensive: if either column isn't applied
  // yet, retry with the check-in alone.
  let { error: updErr } = await sb
    .from('promoter_guests')
    .update({ checked_in_at: stamp, location_consent: true, checked_in_source: 'geofence' })
    .eq('id', guestId)
  if (updErr && /location_consent|checked_in_source|column|schema cache/i.test(updErr.message ?? '')) {
    ;({ error: updErr } = await sb
      .from('promoter_guests')
      .update({ checked_in_at: stamp })
      .eq('id', guestId))
  }
  if (updErr) return err('Failed to check in', 500)

  return ok({ checkedInAt: stamp })
}
