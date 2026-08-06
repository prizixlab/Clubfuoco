import { createHash, randomBytes } from 'crypto'
import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Fuoco Door — server helpers ──────────────────────────────────────────────
// Shared by the /api/door/* routes. Devices authenticate with a bearer token
// (not a Supabase session) — the door app has no user login by design. The
// token's SHA-256 is stored in door_devices; provisioning is gated by real
// club_staff auth (see /api/door/devices).

export type CredentialKind =
  | 'paid_entry' | 'vip_table' | 'guestlist' | 'ticket' | 'membership'

export interface Entitlement { label: string; count: number; extras: string[] }
export interface ManifestEntry {
  token_ref: string
  payload_keys: string[]
  holder_name: string
  holder_avatar_url: string | null
  kind: CredentialKind
  entitlement: Entitlement
  allowed: number
  used: number            // server's current cross-door count (baseline)
  billable: boolean
}
export interface NightManifest {
  venue: string
  venue_name: string
  night: string
  issued_at: string
  server_time: string
  entries: ManifestEntry[]
  signature: string
}

// Swift's default .iso8601 decoder rejects fractional seconds — emit whole-second
// ISO timestamps so the client parses them without a custom strategy.
export const isoNoMs = (d: Date = new Date()) =>
  d.toISOString().replace(/\.\d{3}Z$/, 'Z')

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const newDeviceToken = () => 'dvc_' + randomBytes(24).toString('base64url')
export const newEnrollmentCode = () =>
  'DOOR-' + randomBytes(4).toString('hex').toUpperCase()   // e.g. DOOR-9F3A1C0B

// Free guestlist & membership are excluded from overscan billing (the Terms
// only reserve charges on PAID features).
export const billableForKind = (k: CredentialKind) =>
  k === 'paid_entry' || k === 'vip_table' || k === 'ticket'

// ── Device auth ──────────────────────────────────────────────────────────────

export interface DoorDevice {
  id: string
  club_id: string
  label: string | null
  revoked_at: string | null
}

async function bearer(): Promise<string | null> {
  try {
    const auth = (await headers()).get('authorization')
    return auth?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
  } catch { return null }
}

/**
 * Resolve the enrolled device from its bearer token. Returns the device row, or
 * null if the token is missing / unknown / revoked. Caller returns 401 on null.
 */
export async function authDevice(
  supabase: SupabaseClient,
): Promise<DoorDevice | null> {
  const token = await bearer()
  if (!token) return null
  const { data } = await supabase
    .from('door_devices')
    .select('id, club_id, label, revoked_at, token_hash')
    .eq('token_hash', sha256(token))
    .is('revoked_at', null)
    .maybeSingle()
  if (!data) return null
  // touch last_seen (best-effort; ignore failure)
  void supabase.from('door_devices').update({ last_seen_at: isoNoMs() }).eq('id', data.id)
  return { id: data.id, club_id: data.club_id, label: data.label, revoked_at: data.revoked_at }
}

// ── Manifest signing (HMAC over a canonical summary) ─────────────────────────
// Mirrors the WebCrypto HMAC style used by portal-auth. The client verifies
// this to reject tampered caches. Secret: DOOR_MANIFEST_SECRET.

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function canonical(m: Omit<NightManifest, 'signature'>): string {
  const rows = m.entries
    .map(e => `${e.token_ref}:${e.allowed}:${e.used}`)
    .sort()
    .join(',')
  return `${m.venue}|${m.night}|${m.issued_at}|${rows}`
}

export async function signManifest(m: Omit<NightManifest, 'signature'>): Promise<string> {
  const secret = process.env.DOOR_MANIFEST_SECRET
  if (!secret) return 'unsigned'        // set the env var in prod to enforce
  return hmacHex(secret, canonical(m))
}

// ── Manifest builder (reads the LIVE tables) ─────────────────────────────────
// v1 real credentials: paid bookings + free guestlist. Tickets (external
// platforms, no club_id / QR) and membership are modelled client-side but not
// yet emitted here — deferred per the plan.

export async function buildManifest(
  supabase: SupabaseClient,
  clubId: string,
  date: string,                 // 'yyyy-mm-dd'
): Promise<NightManifest> {
  const [club, entries] = await Promise.all([
    supabase.from('clubs').select('name').eq('id', clubId).maybeSingle(),
    collectEntries(supabase, clubId, date),
  ])

  // Baseline each entry's `used` from the recorded ledger (cross-door truth).
  const usedMap = await usedByToken(supabase, clubId, date)
  for (const e of entries) e.used = Math.max(0, usedMap.get(e.token_ref) ?? 0)

  const base = {
    venue: clubId,
    venue_name: club.data?.name ?? 'Venue',
    night: date,
    issued_at: isoNoMs(),
    server_time: isoNoMs(),
    entries,
  }
  return { ...base, signature: await signManifest(base) }
}

async function collectEntries(
  supabase: SupabaseClient, clubId: string, date: string,
): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = []

  // Paid bookings ------------------------------------------------------------
  const { data: bookings } = await supabase
    .from('bookings')
    // Disambiguate the FK: bookings has TWO users relationships (user_id and
    // checked_in_by), so a bare users(...) embed 300s. We want the guest.
    .select('id, qr_code_token, booking_type, party_size, admissions_allowed, status, arrival_window, users!bookings_user_id_fkey(full_name, avatar_url)')
    .eq('club_id', clubId)
    .eq('booking_date', date)
    .neq('status', 'cancelled')

  for (const b of bookings ?? []) {
    const vip = b.booking_type === 'vip'
    const user = b.users as { full_name?: string; avatar_url?: string } | null
    const allowed = b.admissions_allowed ?? b.party_size ?? 1
    out.push({
      token_ref: `bk_${b.id}`,
      payload_keys: [b.qr_code_token, b.id].filter(Boolean) as string[],
      holder_name: user?.full_name ?? 'Guest',
      holder_avatar_url: user?.avatar_url ?? null,
      kind: vip ? 'vip_table' : 'paid_entry',
      entitlement: {
        label: `${vip ? 'VIP table' : 'Paid entry'} · party of ${b.party_size}`,
        count: b.party_size ?? 1,
        extras: b.arrival_window ? [`Arrival ${b.arrival_window}`] : [],
      },
      allowed,
      used: 0,
      billable: true,
    })
  }

  // Free guestlist -----------------------------------------------------------
  // promoter_guests → promoter_allocations.night_id → promoter_nights(club_id,date)
  const { data: nights } = await supabase
    .from('promoter_nights')
    .select('id')
    .eq('club_id', clubId)
    .eq('night_date', date)
  const nightIds = (nights ?? []).map(n => n.id)

  if (nightIds.length) {
    const { data: allocs } = await supabase
      .from('promoter_allocations')
      .select('id, promoter_id')
      .in('night_id', nightIds)
    const allocIds = (allocs ?? []).map(a => a.id)
    const promoterIds = [...new Set((allocs ?? []).map(a => a.promoter_id).filter(Boolean))]

    // Promoter brand names for the "via @brand" extra (best-effort).
    const brandByPromoter = new Map<string, string>()
    if (promoterIds.length) {
      const { data: profs } = await supabase
        .from('promoter_profiles')
        .select('user_id, brand_name')
        .in('user_id', promoterIds)
      for (const p of profs ?? []) if (p.brand_name) brandByPromoter.set(p.user_id, p.brand_name)
    }
    const promoterByAlloc = new Map((allocs ?? []).map(a => [a.id, a.promoter_id]))

    if (allocIds.length) {
      const { data: guests } = await supabase
        .from('promoter_guests')
        .select('id, full_name, plus_ones, allocation_id')
        .in('allocation_id', allocIds)

      for (const g of guests ?? []) {
        const plus = g.plus_ones ?? 0
        const promoterId = promoterByAlloc.get(g.allocation_id)
        const brand = promoterId ? brandByPromoter.get(promoterId) : undefined
        out.push({
          token_ref: `pg_${g.id}`,
          payload_keys: [g.id],           // the guest QR encodes their id
          holder_name: g.full_name ?? 'Guest',
          holder_avatar_url: null,
          kind: 'guestlist',
          entitlement: {
            label: plus > 0 ? `Guestlist +${plus}` : 'Guestlist',
            count: plus + 1,
            extras: brand ? [`via @${brand}`] : [],
          },
          allowed: plus + 1,
          used: 0,
          billable: false,               // free guestlist — overscan-excluded
        })
      }
    }
  }

  return out
}

// ── Single-token live resolve (open-access, per-scan) ───────────────────────
// The door app scans a QR whose payload is a URL or prefixed string, not a bare
// token. This normalises the payload and resolves it against the live tables,
// returning the uniform Access Descriptor the app renders. No venue/manifest
// needed — fits open-access mode (anyone scans any real QR).

export interface AccessDescriptorDTO {
  holder_name: string
  holder_avatar_url: string | null
  kind: CredentialKind
  entitlement: Entitlement
  allowance: { used: number; allowed: number }
  status: 'ok' | 'already_used' | 'over' | 'cancelled' | 'invalid' | 'wrong_night'
  venue: string
  night: string
  token_ref: string
}

/** Pull the meaningful token out of a scanned QR payload. */
export function parsePayload(payload: string): { kind: 'booking' | 'guest'; token: string } | null {
  const p = payload.trim()
  // Guestlist QR encodes `fuoco-invite:<guestId>` (see promoter-invites qr.svg).
  const invite = p.match(/^fuoco-invite:(.+)$/i)
  if (invite) return { kind: 'guest', token: invite[1].trim() }
  // Booking QR encodes `<APP_URL>/verify/<qr_code_token>`.
  const verify = p.match(/\/verify\/([^/?#]+)/i)
  if (verify) return { kind: 'booking', token: decodeURIComponent(verify[1]) }
  // Bare token fallback. Production qr_code_token values are SHORT reference
  // codes like "CF-5DBXJ2Y7" — not UUIDs — so this must stay permissive rather
  // than assume a hex/UUID shape. Anything that looks like a code (no spaces,
  // no scheme) is tried as a booking token, then as a guest id. The lookups are
  // exact parameterised matches, so a loose pattern here is safe.
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{4,63}$/.test(p)) return { kind: 'booking', token: p }
  return null
}

/** Net admitted heads for one token_ref (admit − void, clamped ≥0). */
export async function usedForToken(supabase: SupabaseClient, tokenRef: string): Promise<number> {
  const { data } = await supabase
    .from('admission_scans')
    .select('action, count')
    .eq('token_ref', tokenRef)
  let n = 0
  for (const r of data ?? []) n += r.action === 'admit' ? r.count : -r.count
  return Math.max(0, n)
}

export async function resolveDescriptor(
  supabase: SupabaseClient, payload: string,
): Promise<AccessDescriptorDTO | null> {
  const parsed = parsePayload(payload)
  if (!parsed) return null

  if (parsed.kind === 'booking') {
    const { data: b } = await supabase
      .from('bookings')
      .select('id, booking_type, party_size, admissions_allowed, status, arrival_window, booking_date, club_id, users!bookings_user_id_fkey(full_name, avatar_url), clubs(name)')
      .eq('qr_code_token', parsed.token)
      .maybeSingle()
    if (!b) {
      // Maybe the URL token was actually a guest id — fall through to guest.
      return resolveGuest(supabase, parsed.token)
    }
    const vip = b.booking_type === 'vip'
    const user = b.users as { full_name?: string; avatar_url?: string } | null
    const club = b.clubs as { name?: string } | null
    const allowed = b.admissions_allowed ?? b.party_size ?? 1
    const tokenRef = `bk_${b.id}`
    const used = await usedForToken(supabase, tokenRef)
    const status = b.status === 'cancelled' ? 'cancelled' : (used >= allowed && used > 0 ? 'over' : 'ok')
    return {
      holder_name: user?.full_name ?? 'Guest',
      holder_avatar_url: user?.avatar_url ?? null,
      kind: vip ? 'vip_table' : 'paid_entry',
      entitlement: {
        label: `${vip ? 'VIP table' : 'Paid entry'} · party of ${b.party_size}`,
        count: b.party_size ?? 1,
        extras: b.arrival_window ? [`Arrival ${b.arrival_window}`] : [],
      },
      allowance: { used, allowed },
      status,
      venue: b.club_id,
      night: b.booking_date,
      token_ref: tokenRef,
    }
  }
  return resolveGuest(supabase, parsed.token)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveGuest(supabase: SupabaseClient, guestId: string): Promise<AccessDescriptorDTO | null> {
  // promoter_guests.id is a uuid PK; querying it with a short code (CF-…) is a
  // PostgREST type error, not a miss. Skip the lookup unless it can match.
  if (!UUID_RE.test(guestId)) return null
  const { data: g } = await supabase
    .from('promoter_guests')
    .select('id, full_name, plus_ones, allocation_id, promoter_allocations(night_id, promoter_nights(club_id, night_date, clubs(name)))')
    .eq('id', guestId)
    .maybeSingle()
  if (!g) return null
  const alloc = g.promoter_allocations as { promoter_nights?: { club_id?: string; night_date?: string; clubs?: { name?: string } } } | null
  const night = alloc?.promoter_nights
  const plus = g.plus_ones ?? 0
  const allowed = plus + 1
  const tokenRef = `pg_${g.id}`
  const used = await usedForToken(supabase, tokenRef)
  return {
    holder_name: g.full_name ?? 'Guest',
    holder_avatar_url: null,
    kind: 'guestlist',
    entitlement: {
      label: plus > 0 ? `Guestlist +${plus}` : 'Guestlist',
      count: allowed,
      extras: [],
    },
    allowance: { used, allowed },
    status: used >= allowed && used > 0 ? 'over' : 'ok',
    venue: night?.club_id ?? '',
    night: night?.night_date ?? '',
    token_ref: tokenRef,
  }
}

/** Net admitted heads per token_ref for a club/night (admit − void, clamped ≥0). */
export async function usedByToken(
  supabase: SupabaseClient, clubId: string, date: string,
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('admission_scans')
    .select('token_ref, action, count')
    .eq('club_id', clubId)
    .eq('night_date', date)
  const m = new Map<string, number>()
  for (const r of data ?? []) {
    m.set(r.token_ref, (m.get(r.token_ref) ?? 0) + (r.action === 'admit' ? r.count : -r.count))
  }
  return m
}
