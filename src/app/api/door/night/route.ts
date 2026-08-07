import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { isoNoMs, usedByToken } from '@/lib/door'
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
  const venue = req.nextUrl.searchParams.get('venue')
  const date = req.nextUrl.searchParams.get('date')
  if (!venue || !date) return err('venue and date required', 400)

  const supabase = await createServiceClient()
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
  const { data: nights } = await supabase
    .from('promoter_nights').select('id').eq('club_id', venue).eq('night_date', date)
  const nightIds = (nights ?? []).map(n => n.id)
  if (nightIds.length) {
    const { data: allocs } = await supabase
      .from('promoter_allocations').select('id').in('night_id', nightIds)
    const allocIds = (allocs ?? []).map(a => a.id)
    if (allocIds.length) {
      const { data: guests } = await supabase
        .from('promoter_guests')
        .select('id, full_name, plus_ones').in('allocation_id', allocIds)
      for (const g of guests ?? []) {
        const plus = g.plus_ones ?? 0
        const tokenRef = `pg_${g.id}`
        entries.push(...sealEntry({
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
    }
  }

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
