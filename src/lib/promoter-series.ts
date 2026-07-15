import type { SupabaseClient } from '@supabase/supabase-js'
import { allocationBlocked, seriesBlocked } from '@/lib/promoter-review'

/**
 * Promoter "series" = a recurring guestlist with ONE permanent invite token.
 * Concrete nights/allocations are materialized lazily the first time someone
 * opens the link (or the promoter views it) for a given week.
 *
 * All date math is done in Madrid wall-clock time and compared lexically as
 * "yyyy-mm-ddTHH:MM" strings — no UTC conversion, DST-safe enough for a
 * nightlife app (the once-a-year DST hour is immaterial to "which night").
 */

export interface PromoterSeries {
  id: string
  promoter_id: string
  club_id: string | null
  title: string | null
  weekdays: number[] // 1=Sun … 7=Sat (Swift Calendar.weekday convention)
  open_time: string | null // "HH:MM:SS"
  close_time: string | null // "HH:MM:SS"
  spots: number
  payout_per_guest: number
  group_visible: boolean
  invite_token: string
  is_active: boolean
  location_name: string | null
  address: string | null
  lat: number | null
  lng: number | null
  auto_checkin: boolean
  description: string | null
  theme: string | null
  theme_translate: boolean
  photo_urls: string[]
  featured: boolean
  max_plus_ones: number | null
  // Drift-defensive: lands with the 20260715 migration. Undefined until the
  // column exists — treated as "no weeks skipped".
  skipped_dates?: string[] | null
}

const MADRID = 'Europe/Madrid'

/** "now" in Madrid as a sortable "yyyy-mm-ddTHH:MM" wall-clock string. */
function nowMadridWall(now = new Date()): string {
  // sv-SE locale formats as "yyyy-mm-dd HH:MM:SS"
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: MADRID,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
  return s.replace(' ', 'T').slice(0, 16) // "yyyy-mm-ddTHH:MM"
}

/** Today's Madrid calendar date as "yyyy-mm-dd". */
function todayMadrid(now = new Date()): string {
  return nowMadridWall(now).slice(0, 10)
}

/** Weekday of a yyyy-mm-dd in Swift convention (1=Sun … 7=Sat). */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1
}

/** Add N days to a yyyy-mm-dd, return yyyy-mm-dd. */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

/** Add one hour to "HH:MM:SS"; returns { time: "HH:MM", rolledDay: boolean }. */
function plusOneHour(hms: string): { time: string; rolledDay: boolean } {
  const [h, mn] = hms.split(':').map(Number)
  const nh = h + 1
  if (nh >= 24) return { time: `${String(nh - 24).padStart(2, '0')}:${String(mn).padStart(2, '0')}`, rolledDay: true }
  return { time: `${String(nh).padStart(2, '0')}:${String(mn).padStart(2, '0')}`, rolledDay: false }
}

/**
 * The wall-clock instant (as "yyyy-mm-ddTHH:MM") after which an occurrence on
 * `date` is no longer claimable. = close_time + 1h, else 4 AM next day.
 */
function liveUntil(series: PromoterSeries, date: string): string {
  if (series.close_time) {
    const open = series.open_time ?? '23:00:00'
    // Clubs run overnight: if close is at/earlier than open, it's the next day.
    const overnight = series.close_time <= open
    const { time, rolledDay } = plusOneHour(series.close_time)
    const closeDate = addDays(date, (overnight ? 1 : 0) + (rolledDay ? 1 : 0))
    return `${closeDate}T${time}`
  }
  return `${addDays(date, 1)}T04:00`
}

/**
 * Resolve which calendar date the permanent link points at right now.
 * Returns the earliest upcoming occurrence (across the series' weekdays)
 * whose live-window hasn't ended. Null if the series has no weekdays.
 */
export function resolveOccurrenceDate(series: PromoterSeries, now = new Date()): string | null {
  if (!series.weekdays?.length) return null
  const nowWall = nowMadridWall(now)
  const start = todayMadrid(now)
  const skipped = new Set(series.skipped_dates ?? [])
  // Start at yesterday (i=-1): a Friday night's window runs into Saturday
  // morning, so when "now" is Sat 03:00 the still-live occurrence is
  // yesterday's date. The liveUntil check drops it once the window closes.
  for (let i = -1; i < 14; i++) {
    const date = addDays(start, i)
    if (!series.weekdays.includes(weekdayOf(date))) continue
    if (skipped.has(date)) continue   // promoter took this week off
    if (liveUntil(series, date) > nowWall) return date
  }
  return null
}

/**
 * Ensure a night + allocation exist for this series occurrence and return the
 * allocation id. Idempotent via the (series_id, night_date) unique index.
 * Must run with the service-role client (writes bypass RLS).
 */
export async function ensureOccurrence(
  sb: SupabaseClient,
  series: PromoterSeries,
  date: string
): Promise<string | null> {
  // Insert the night. NB: the (series_id, night_date) uniqueness is enforced
  // by a PARTIAL index, which Postgres can't use as an ON CONFLICT target
  // (error 42P10) — so we insert and fall back to a read on unique-violation
  // instead of upserting.
  const { data: night, error: nightErr } = await sb
    .from('promoter_nights')
    .insert({
      series_id: series.id,
      club_id: series.club_id,
      title: series.title,
      night_date: date,
      open_time: series.open_time,
      close_time: series.close_time,
      total_capacity: Math.max(series.spots, 50),
      is_published: true,
      location_name: series.location_name,
      address: series.address,
      lat: series.lat,
      lng: series.lng,
      auto_checkin: series.auto_checkin,
      description: series.description,
      theme: series.theme,
      theme_translate: series.theme_translate,
      photo_urls: series.photo_urls,
      featured: series.featured,
      max_plus_ones: series.max_plus_ones,
    })
    .select('id')
    .single()

  let nightId = night?.id as string | undefined
  if (!nightId) {
    // 23505 = unique_violation (this week already materialized, or a race).
    if (nightErr && nightErr.code !== '23505') return null
    const { data: existing } = await sb
      .from('promoter_nights')
      .select('id')
      .eq('series_id', series.id)
      .eq('night_date', date)
      .single()
    nightId = existing?.id
  }
  if (!nightId) return null
  return ensureAllocation(sb, nightId, series)
}

async function ensureAllocation(
  sb: SupabaseClient,
  nightId: string,
  series: PromoterSeries
): Promise<string | null> {
  // One allocation per (night, promoter). Upsert keeps spots/payout/visibility
  // in sync with the series at materialization time.
  const { data: alloc } = await sb
    .from('promoter_allocations')
    .upsert(
      {
        night_id: nightId,
        promoter_id: series.promoter_id,
        spots: series.spots,
        payout_per_guest: series.payout_per_guest,
        group_visible: series.group_visible,
      },
      { onConflict: 'night_id,promoter_id', ignoreDuplicates: true }
    )
    .select('id')
    .single()

  if (alloc) return alloc.id
  const { data: existing } = await sb
    .from('promoter_allocations')
    .select('id')
    .eq('night_id', nightId)
    .eq('promoter_id', series.promoter_id)
    .single()
  return existing?.id ?? null
}

/**
 * Resolve a public token (one-off allocation OR series) to a concrete
 * allocation id, materializing the series occurrence if needed.
 * Returns { allocationId, seriesToken } — seriesToken is set when the token
 * belonged to a series (so the UI can keep showing the permanent link).
 */
export async function resolveTokenToAllocation(
  sb: SupabaseClient,
  token: string
): Promise<{ allocationId: string; seriesToken: string | null; referralId: string | null } | null> {
  // 1. One-off allocation token. Held (unapproved) nights don't resolve.
  const { data: oneOff } = await sb
    .from('promoter_allocations')
    .select('id')
    .eq('invite_token', token)
    .maybeSingle()
  if (oneOff) {
    if (await allocationBlocked(sb, oneOff.id)) return null
    return { allocationId: oneOff.id, seriesToken: null, referralId: null }
  }

  // 2. Series token → resolve + materialize. A held series doesn't materialize.
  const { data: series } = await sb
    .from('promoter_series')
    .select('*')
    .eq('invite_token', token)
    .eq('is_active', true)
    .maybeSingle()
  if (series) {
    if (await seriesBlocked(sb, (series as PromoterSeries).id)) return null
    const date = resolveOccurrenceDate(series as PromoterSeries)
    if (!date) return null
    const allocationId = await ensureOccurrence(sb, series as PromoterSeries, date)
    if (!allocationId) return null
    return { allocationId, seriesToken: token, referralId: null }
  }

  // 3. Staff referral token → resolve its allocation or series, tag attribution.
  const { data: ref } = await sb
    .from('promoter_referrals')
    .select('id, allocation_id, series_id')
    .eq('token', token)
    .maybeSingle()
  if (!ref) return null

  if (ref.allocation_id) {
    return { allocationId: ref.allocation_id, seriesToken: null, referralId: ref.id }
  }
  if (ref.series_id) {
    const { data: refSeries } = await sb
      .from('promoter_series').select('*').eq('id', ref.series_id).eq('is_active', true).maybeSingle()
    if (!refSeries) return null
    const date = resolveOccurrenceDate(refSeries as PromoterSeries)
    if (!date) return null
    const allocationId = await ensureOccurrence(sb, refSeries as PromoterSeries, date)
    if (!allocationId) return null
    // Keep showing the staff token as the permanent link.
    return { allocationId, seriesToken: token, referralId: ref.id }
  }
  return null
}
