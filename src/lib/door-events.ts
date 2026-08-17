import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sha256, isoNoMs } from './door'
import {
  ensureOccurrence, resolveOccurrenceDate, type PromoterSeries,
} from './promoter-series'

// ── Event door codes ─────────────────────────────────────────────────────────
//
// A door scopes itself by picking a VENUE. A private event usually has no venue
// — it's a warehouse, a roof, a finca — so there is nothing for the picker to
// show and nothing for `ScanController.scoped()` to compare against. The event
// code solves both problems at once: it is the promoter's control over who may
// admit at their door, AND it is what gives that door a scope.
//
// Threat model, stated plainly because it decides how much machinery is
// justified: the code stops a stranger from admitting people to someone else's
// private party. It is a room key shared with a door team over WhatsApp, not an
// account credential.
//
// It deliberately does NOT have to protect guest identities, because
// door-crypto.ts already does — every night-pack entry is sealed against that
// guest's own QR token, so a leaked code buys the ability to admit, not a guest
// list. That is what lets the code stay six characters and human-readable.

/** Session bearer. `dvc_` is a club-enrolled device; `evt_` is one event. */
export const newEventToken = () => 'evt_' + randomBytes(24).toString('base64url')

/**
 * Same unambiguous alphabet as the SQL generator. Every character that gets
 * misread off a phone screen in the dark is simply absent — 0 and O, 1 and I
 * and L. 31 symbols, so a 6-character code is 31⁶ ≈ 8.9e8 combinations.
 *
 * Because the ambiguous pairs are excluded from the alphabet rather than
 * folded together, there is nothing for a normaliser to disambiguate: a typed
 * O or 0 is not a misread of anything, it is just wrong.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function generateDoorCode(): string {
  let out = ''
  // Rejection sampling rather than `% ALPHABET.length`: 256 is not a multiple
  // of 31, so the modulo would make the first eight symbols measurably more
  // likely than the rest.
  const limit = 256 - (256 % ALPHABET.length)
  while (out.length < 6) {
    for (const b of randomBytes(6)) {
      if (b >= limit) continue
      out += ALPHABET[b % ALPHABET.length]
      if (out.length === 6) break
    }
  }
  return out
}

/** Uppercase, strip whatever punctuation or spacing they pasted around it. */
export function normalizeDoorCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export interface DoorCodeRow {
  id: string
  promoter_id: string
  night_id: string | null
  series_id: string | null
  code: string
}

/**
 * A door session's expiry: the end of the night plus the 12-hour ceiling the
 * door app already enforces on its offline cache.
 *
 * A scanner that walks away from a private event stops being able to admit
 * anyone by the following afternoon, with no revocation needed. Computed in UTC
 * from the date string — Madrid is an hour or two off, which is immaterial
 * against a 12-hour window.
 */
export function sessionExpiry(nightDate: string, closeTime: string | null): Date {
  const end = new Date(`${nightDate}T00:00:00Z`)
  const [h, m] = (closeTime ?? '06:00:00').split(':').map(Number)
  end.setUTCHours(h || 0, m || 0, 0, 0)
  // A close time before noon belongs to the following morning: a night on the
  // 19th that closes at 06:00 ends on the 20th, not twelve hours before it
  // started.
  if ((h ?? 6) < 12) end.setUTCDate(end.getUTCDate() + 1)
  end.setUTCHours(end.getUTCHours() + 12)
  return end
}

export interface RedeemedSession {
  token: string
  nightId: string
  nightDate: string
  eventName: string
  expiresAt: string
}

/**
 * Exchange a typed code for a night-scoped bearer token.
 *
 * A code may be bound to one night or to a whole series — a recurring private
 * event should not hand its door team a new code every week. A series code
 * resolves to the occurrence that is live now, materializing it if this is the
 * first time anyone has asked, exactly as an invite link does.
 *
 * Returns null for an unknown code, and for a series with nothing on tonight.
 */
export async function redeemDoorCode(
  sb: SupabaseClient,
  rawCode: string,
  meta: { label?: string | null; deviceModel?: string | null } = {},
): Promise<RedeemedSession | null> {
  const code = normalizeDoorCode(rawCode)
  if (code.length !== 6) return null

  const { data } = await sb
    .from('promoter_door_codes')
    .select('id, promoter_id, night_id, series_id, code')
    .eq('code', code)
    .maybeSingle()
  const row = data as DoorCodeRow | null
  if (!row) return null

  let nightId = row.night_id
  if (!nightId && row.series_id) {
    const { data: series } = await sb
      .from('promoter_series').select('*')
      .eq('id', row.series_id).eq('is_active', true).maybeSingle()
    if (!series) return null
    const date = resolveOccurrenceDate(series as PromoterSeries)
    if (!date) return null                       // nothing on tonight
    const allocationId = await ensureOccurrence(sb, series as PromoterSeries, date)
    if (!allocationId) return null
    const { data: alloc } = await sb
      .from('promoter_allocations').select('night_id').eq('id', allocationId).maybeSingle()
    nightId = (alloc as { night_id?: string } | null)?.night_id ?? null
  }
  if (!nightId) return null

  const { data: night } = await sb
    .from('promoter_nights')
    .select('id, title, night_date, close_time, location_name, clubs(name)')
    .eq('id', nightId).maybeSingle()
  if (!night) return null

  const nightRow = night as {
    id: string; title: string | null; night_date: string
    close_time: string | null; location_name: string | null
    clubs: { name?: string } | null
  }

  const token = newEventToken()
  const expiresAt = sessionExpiry(nightRow.night_date, nightRow.close_time)
  const { error } = await sb.from('door_event_sessions').insert({
    night_id: nightRow.id,
    code_id: row.id,
    token_hash: sha256(token),
    label: meta.label ?? null,
    device_model: meta.deviceModel ?? null,
    expires_at: isoNoMs(expiresAt),
    last_seen_at: isoNoMs(),
  })
  if (error) return null

  return {
    token,
    nightId: nightRow.id,
    nightDate: nightRow.night_date,
    eventName: nightRow.title
      ?? nightRow.clubs?.name ?? nightRow.location_name ?? 'Private event',
    expiresAt: isoNoMs(expiresAt),
  }
}

export interface EventSession { id: string; nightId: string }

/**
 * Resolve an `evt_` bearer to its night. Null when missing, unknown, revoked or
 * expired — the caller returns 401/403.
 *
 * Takes the header off the request rather than next/headers so this is usable
 * from any route regardless of how it was invoked.
 */
export async function authEventSession(
  sb: SupabaseClient, req: Request,
): Promise<EventSession | null> {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token || !token.startsWith('evt_')) return null

  const { data } = await sb
    .from('door_event_sessions')
    .select('id, night_id, expires_at, revoked_at')
    .eq('token_hash', sha256(token))
    .maybeSingle()
  if (!data || data.revoked_at) return null
  if (new Date(data.expires_at) < new Date()) return null

  void sb.from('door_event_sessions')
    .update({ last_seen_at: isoNoMs() }).eq('id', data.id)
  return { id: data.id, nightId: data.night_id }
}

/**
 * Is this night private?
 *
 * Drift-defensive: before the migration lands there are no private nights, so
 * a missing column reads as public — which is exactly today's behaviour, and
 * keeps every club night scanning while the migration is pending.
 */
export async function nightIsPrivate(sb: SupabaseClient, nightId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('promoter_nights').select('visibility').eq('id', nightId).maybeSingle()
  if (error || !data) return false
  return (data as { visibility?: string }).visibility === 'private'
}

/**
 * The gate. A private night may only be scanned by a door holding a live
 * session for THAT night; everything else is untouched, so club nights and
 * public promoter nights keep working exactly as they do now.
 *
 * Applied on /night, /resolve AND /admit. All three, or it's theatre: gating
 * the pack download while leaving admit open would let anyone walk guests in,
 * and gating admit while leaving resolve open would leak who is on the list.
 */
export async function eventAccessDenied(
  sb: SupabaseClient, req: Request, nightId: string | null,
): Promise<'ok' | 'needs_code' | 'wrong_event'> {
  if (!nightId) return 'ok'
  if (!(await nightIsPrivate(sb, nightId))) return 'ok'
  const session = await authEventSession(sb, req)
  if (!session) return 'needs_code'
  return session.nightId === nightId ? 'ok' : 'wrong_event'
}

/** Rotating a code invalidates every door that redeemed the old one. */
export async function revokeSessionsForCode(sb: SupabaseClient, codeId: string): Promise<void> {
  await sb.from('door_event_sessions')
    .update({ revoked_at: isoNoMs() })
    .eq('code_id', codeId)
    .is('revoked_at', null)
}
