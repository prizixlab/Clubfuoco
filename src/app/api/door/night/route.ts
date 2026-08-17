import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { isoNoMs, usedByToken, usedByNight } from '@/lib/door'
import { authEventSession } from '@/lib/door-events'
import { sealEntry, type EncryptedManifest, type SealedEntry } from '@/lib/door-crypto'

// GET /api/door/night?venue=<club_id>&date=<yyyy-mm-dd>
//
// The offline night pack. Every entry is individually encrypted with a key
// derived from that guest's own QR token, so this response — and the cache the
// app writes from it — is unreadable without physically scanning the code. The
// server holds no per-device key and the app stores none: there is nothing to
// steal off the phone that would open the list.
//
// Open-access (no device enrollment) to match the door app's current mode. That
// is deliberate: an attacker who fetches this gets a blob of sealed entries plus
// counts, not a guest list.
export async function GET(req: NextRequest) {
  const supabase = await createServiceClient()

  // ── Event mode ────────────────────────────────────────────────────────────
  // A private event usually has no club, so there is no venue to ask for. The
  // door redeemed an event code instead, and that session IS the scope.
  const eventId = req.nextUrl.searchParams.get('event')
  if (eventId) return eventPack(supabase, req, eventId)

  const venue = req.nextUrl.searchParams.get('venue')
  const date = req.nextUrl.searchParams.get('date')
  if (!venue || !date) return err('venue and date required', 400)
  const [club, usedMap] = await Promise.all([
    supabase.from('clubs').select('name').eq('id', venue).maybeSingle(),
    usedByToken(supabase, venue, date),
  ])

  const entries: SealedEntry[] = []

  // ── Paid bookings ─────────────────────────────────────────────────────────
  // scan_token lands with a manual migration; fall back to CF-only sealing if
  // it isn't applied yet (prod drifts from /migrations).
  let bookings: Record<string, unknown>[] | null = null
  const rich = await supabase
    .from('bookings')
    .select('id, qr_code_token, scan_token, booking_type, party_size, admissions_allowed, arrival_window, users!bookings_user_id_fkey(full_name, avatar_url)')
    .eq('club_id', venue).eq('booking_date', date).neq('status', 'cancelled')
  if (rich.error) {
    const lean = await supabase
      .from('bookings')
      .select('id, qr_code_token, booking_type, party_size, admissions_allowed, arrival_window, users!bookings_user_id_fkey(full_name, avatar_url)')
      .eq('club_id', venue).eq('booking_date', date).neq('status', 'cancelled')
    bookings = lean.data
  } else {
    bookings = rich.data
  }

  for (const b of bookings ?? []) {
    const vip = b.booking_type === 'vip'
    const user = b.users as { full_name?: string; avatar_url?: string } | null
    const partySize = (b.party_size as number) ?? 1
    const tokenRef = `bk_${b.id}`
    entries.push(...sealEntry({
      strongToken: (b.scan_token as string) ?? null,
      // No legacy record: CF- reference codes no longer admit anyone, so the
      // offline pack must not carry a PBKDF2-wrapped copy keyed to one either.
      legacyToken: null,
      payload: {
        holder_name: user?.full_name ?? 'Guest',
        holder_avatar_url: user?.avatar_url ?? null,
        kind: vip ? 'vip_table' : 'paid_entry',
        entitlement: {
          label: `${vip ? 'VIP table' : 'Paid entry'} · party of ${partySize}`,
          count: partySize,
          extras: b.arrival_window ? [`Arrival ${b.arrival_window}`] : [],
        },
      },
      allowed: (b.admissions_allowed as number) ?? partySize,
      used: Math.max(0, usedMap.get(tokenRef) ?? 0),
      billable: true,
      tokenRef,
    }))
  }

  // ── Free guestlist ────────────────────────────────────────────────────────
  // The guest QR encodes `fuoco-invite:<uuid>`; the uuid is 122-bit, so it goes
  // down the STRONG path — no slow KDF needed.
  // A private event is excluded from its venue's pack even when it IS at a
  // club: its door is the promoter's, reached only by redeeming the event code
  // (the `?event=` branch above). Drift-defensive — before the migration there
  // are no private nights, so the lean select is exactly today's behaviour.
  const withVisibility = await supabase
    .from('promoter_nights').select('id, visibility')
    .eq('club_id', venue).eq('night_date', date)
  const nightRows: { id: string; visibility?: string }[] = withVisibility.error
    ? ((await supabase
        .from('promoter_nights').select('id')
        .eq('club_id', venue).eq('night_date', date)).data ?? [])
    : (withVisibility.data ?? [])
  const nightIds = nightRows
    .filter(n => n.visibility !== 'private')
    .map(n => n.id)

  entries.push(...await sealGuests(supabase, nightIds, usedMap))

  const manifest: EncryptedManifest = {
    venue,
    venue_name: club.data?.name ?? 'Venue',
    night: date,
    issued_at: isoNoMs(),
    server_time: isoNoMs(),
    entries,
    scheme: 'v1',
  }
  return ok(manifest)
}

/**
 * The offline pack for ONE private event, authorised by an event-code session.
 *
 * `venue` carries the night id rather than a club id, because that is what this
 * door is scoped to — `ScanController.scoped()` compares the descriptor's
 * `event_id` against it. A private event may have no club at all, so a club id
 * is not available to put there and would not be the right thing to compare
 * anyway.
 */
async function eventPack(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  req: NextRequest,
  eventId: string,
) {
  const session = await authEventSession(supabase, req)
  if (!session) return err('Enter the event code to load this event.', 401)
  if (session.nightId !== eventId) return err('That code is for a different event.', 403)

  const { data: night } = await supabase
    .from('promoter_nights')
    .select('id, title, night_date, location_name, clubs(name)')
    .eq('id', eventId).maybeSingle()
  if (!night) return err('Event not found', 404)

  const row = night as {
    id: string; title: string | null; night_date: string
    location_name: string | null; clubs: { name?: string } | null
  }

  // Keyed on the night, not the club — the whole point of the night_id column
  // on admission_scans.
  const usedMap = await usedByNight(supabase, eventId)
  const entries = await sealGuests(supabase, [eventId], usedMap)

  const manifest: EncryptedManifest = {
    venue: row.id,                 // the door's scope IS the event
    venue_name: row.title ?? row.clubs?.name ?? row.location_name ?? 'Private event',
    night: row.night_date,
    issued_at: isoNoMs(),
    server_time: isoNoMs(),
    entries,
    scheme: 'v1',
  }
  return ok(manifest)
}

/**
 * Seal every guest on the given nights.
 *
 * A guest's QR encodes `fuoco-invite:<uuid>`; the uuid is 122-bit, so it takes
 * the strong HKDF path — no slow KDF needed. Shared by both packs so an entry
 * cannot be sealed one way for a venue and another way for an event.
 */
async function sealGuests(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  nightIds: string[],
  usedMap: Map<string, number>,
): Promise<SealedEntry[]> {
  if (!nightIds.length) return []

  const { data: allocs } = await supabase
    .from('promoter_allocations').select('id').in('night_id', nightIds)
  const allocIds = (allocs ?? []).map(a => a.id)
  if (!allocIds.length) return []

  const { data: guests } = await supabase
    .from('promoter_guests')
    .select('id, full_name, plus_ones').in('allocation_id', allocIds)

  const out: SealedEntry[] = []
  for (const g of guests ?? []) {
    const plus = g.plus_ones ?? 0
    const tokenRef = `pg_${g.id}`
    out.push(...sealEntry({
      strongToken: g.id,                 // the uuid IS the scanned secret
      legacyToken: null,
      payload: {
        holder_name: g.full_name ?? 'Guest',
        holder_avatar_url: null,
        kind: 'guestlist',
        entitlement: {
          label: plus > 0 ? `Guestlist +${plus}` : 'Guestlist',
          count: plus + 1, extras: [],
        },
      },
      allowed: plus + 1,
      used: Math.max(0, usedMap.get(tokenRef) ?? 0),
      billable: false,
      tokenRef,
    }))
  }
  return out
}
