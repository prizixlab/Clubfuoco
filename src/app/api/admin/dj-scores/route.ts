import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import {
  rankDJs, creditShares, HEADLINER_SHARE,
  type Night, type NightArtist, type Review,
} from '@/lib/dj-score'

// Recompute the internal DJ music scores.
//
// All the reasoning about WHY the numbers are built this way lives in
// src/lib/dj-score.ts, which is pure and unit-tested. This file is only
// plumbing: read the surveys, work out who was playing, hand it to the
// algorithm, store the result.
//
// A night is (club_id, booking_date) — not bookings.night_id, which exists but
// is unpopulated, and which only ever covers promoter-sold nights anyway. See
// the migration header (20260922_dj_music_scores.sql).
//
// Cron: daily, AFTER /api/admin/sync-events. The lineups come from `events`, so
// scoring before the programme refresh would attribute last week's bill.
//
// ?dry=1 computes and reports without writing anything, which also makes this
// runnable before the migration has been applied in the SQL editor.

/** Guard against one pathological club+date pulling the whole page budget. */
const MAX_SURVEYS = 20_000

interface BookingRow {
  id: string
  club_id: string | null
  booking_date: string
}

/** `events.lineup` is [{id, name}] where `id` IS the RA artist id, so it is
 *  strictly better than `artists` (bare names). Fall back to name matching
 *  only when the lineup is absent. */
interface EventRow {
  ra_event_id: string | null
  club_id: string | null
  date: string
  artists: string[] | null
  lineup: { id?: string | null; name?: string | null }[] | null
}

const nightKey = (clubId: string, date: string) => `${clubId}:${date}`

/** 0 = Sunday … 6 = Saturday. Parsed as UTC so a date-only string can't drift a
 *  day on a machine west of Greenwich — which would move a Saturday to a Friday
 *  and quietly corrupt every weekday baseline. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export async function GET(req: Request) {
  // Vercel cron carries a bearer; otherwise require the admin secret.
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) return err('Unauthorized', 401)

  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const sb = await createServiceClient()

  // ── 1. Surveys, and the bookings they belong to ──────────────────────────
  const { data: surveys, error: sErr } = await sb
    .from('booking_surveys')
    .select('booking_id, vibe_rating')
    .not('vibe_rating', 'is', null)
    .limit(MAX_SURVEYS)
  if (sErr) return err(`surveys: ${sErr.message}`, 500)
  if (!surveys?.length) return ok({ nights: 0, djs: 0, note: 'no surveys yet' })

  const surveyBookingIds = [...new Set(surveys.map(s => s.booking_id))]
  const { data: surveyed, error: bErr } = await sb
    .from('bookings')
    .select('id, club_id, booking_date')
    .in('id', surveyBookingIds)
  if (bErr) return err(`bookings: ${bErr.message}`, 500)

  const bookingById = new Map<string, BookingRow>(
    (surveyed ?? []).map(b => [b.id, b as BookingRow]))

  // ── 2. Bookings per night — the response-rate denominator ────────────────
  // Every booking at the clubs/dates in play, not just the surveyed ones.
  const clubIds = [...new Set((surveyed ?? []).map(b => b.club_id).filter((c): c is string => !!c))]
  const dates = [...new Set((surveyed ?? []).map(b => b.booking_date))]

  const bookingsPerNight = new Map<string, number>()
  if (clubIds.length && dates.length) {
    const { data: allBookings, error: abErr } = await sb
      .from('bookings')
      .select('club_id, booking_date')
      .in('club_id', clubIds)
      .in('booking_date', dates)
      .neq('status', 'cancelled')
    if (abErr) return err(`booking counts: ${abErr.message}`, 500)
    for (const b of allBookings ?? []) {
      if (!b.club_id) continue
      const k = nightKey(b.club_id, b.booking_date)
      bookingsPerNight.set(k, (bookingsPerNight.get(k) ?? 0) + 1)
    }
  }

  // ── 3. Who was playing ───────────────────────────────────────────────────
  const eventsByNight = new Map<string, EventRow>()
  if (clubIds.length && dates.length) {
    const { data: evs, error: eErr } = await sb
      .from('events')
      .select('ra_event_id, club_id, date, artists, lineup')
      .in('club_id', clubIds)
      .in('date', dates)
    if (eErr) return err(`events: ${eErr.message}`, 500)
    for (const e of (evs ?? []) as EventRow[]) {
      if (!e.club_id) continue
      const k = nightKey(e.club_id, e.date)
      // More than one event can match a club+date (two rooms, an early show).
      // Keep the one with the deepest bill: it is the night people mean.
      const depth = (r: EventRow) => (r.lineup?.length ?? r.artists?.length ?? 0)
      const held = eventsByNight.get(k)
      if (!held || depth(e) > depth(held)) eventsByNight.set(k, e)
    }
  }

  // Names with no RA id in the lineup get resolved against `djs` by name, so an
  // artist we already know about isn't filed as a fresh 'guest:' every time.
  const loneNames = new Set<string>()
  for (const e of eventsByNight.values()) {
    if (e.lineup?.length) continue
    for (const n of e.artists ?? []) if (n?.trim()) loneNames.add(n.trim())
  }
  const idByName = new Map<string, string>()
  if (loneNames.size) {
    const { data: djs } = await sb
      .from('djs')
      .select('ra_artist_id, name')
      .in('name', [...loneNames])
    for (const d of djs ?? []) {
      if (d.name && d.ra_artist_id) idByName.set(d.name.trim().toLowerCase(), d.ra_artist_id)
    }
  }

  function artistsFor(key: string): NightArtist[] {
    const e = eventsByNight.get(key)
    if (!e) return []
    if (e.lineup?.length) {
      // Billing order is the array order — RA lists the bill top-down.
      return e.lineup
        .map((a, i) => ({ id: a?.id?.trim(), name: a?.name?.trim(), i }))
        .filter(a => a.id || a.name)
        .map(a => ({
          raArtistId: a.id || `guest:${(a.name ?? '').toLowerCase()}`,
          billing: a.i,
        }))
    }
    return (e.artists ?? [])
      .map(n => n?.trim())
      .filter((n): n is string => !!n)
      .map((n, i) => ({
        raArtistId: idByName.get(n.toLowerCase()) ?? `guest:${n.toLowerCase()}`,
        billing: i,
      }))
  }

  // ── 4. Assemble the nights ───────────────────────────────────────────────
  const reviewsByNight = new Map<string, Review[]>()
  for (const s of surveys) {
    const b = bookingById.get(s.booking_id)
    if (!b?.club_id) continue
    const k = nightKey(b.club_id, b.booking_date)
    // `intent` is deliberately absent: the booking flow does not yet record
    // the surface a booking came from, so there is no honest way to tell a
    // fan's review from anyone else's. dj-score treats that as a full-weight
    // review. Populate it (booking → referral surface) and the fan discount
    // starts working with no change here.
    const list = reviewsByNight.get(k) ?? []
    list.push({ vibe: Number(s.vibe_rating) })
    reviewsByNight.set(k, list)
  }

  const nights: Night[] = [...reviewsByNight.entries()].map(([key, reviews]) => {
    const [clubId, date] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    return {
      key,
      clubId,
      weekday: weekdayOf(date),
      bookings: bookingsPerNight.get(key) ?? 0,
      reviews,
      artists: artistsFor(key),
    }
  })

  // ── 5. The maths ─────────────────────────────────────────────────────────
  const ranking = rankDJs(nights)

  const summary = {
    nights: ranking.nights.length,
    nightsScored: ranking.nights.filter(n => n.eligible).length,
    responses: surveys.length,
    nightsWithLineup: nights.filter(n => n.artists.length > 0).length,
    djs: ranking.djs.length,
    scored: ranking.djs.filter(d => d.score !== null).length,
    global: Number(ranking.baselines.global.toFixed(3)),
    top: ranking.djs.slice(0, 10).map(d => ({
      artist: d.raArtistId,
      effect: Number(d.effect.toFixed(3)),
      score: d.score === null ? null : Number(d.score.toFixed(2)),
      nights: d.nightsN,
      venues: d.venuesN,
      confidence: d.confidence,
    })),
  }

  if (dry) return ok({ dry: true, ...summary })

  // ── 6. Store ─────────────────────────────────────────────────────────────
  const computed_at = new Date().toISOString()

  // Nights first: the rest reference them.
  const nightRows = nights.map(n => ({
    club_id: n.clubId,
    night_date: n.key.slice(n.key.indexOf(':') + 1),
    ra_event_id: eventsByNight.get(n.key)?.ra_event_id ?? null,
    weekday: n.weekday,
    lineup_size: n.artists.length,
    bookings_n: n.bookings,
    updated_at: computed_at,
  }))
  const { data: savedNights, error: nErr } = await sb
    .from('music_nights')
    .upsert(nightRows, { onConflict: 'club_id,night_date' })
    .select('id, club_id, night_date')
  if (nErr) return err(`music_nights: ${nErr.message}`, 500)

  const idByNight = new Map<string, string>(
    (savedNights ?? []).map(r => [nightKey(r.club_id, r.night_date), r.id]))

  // Lineups: replace rather than merge, so a corrected scrape drops the artists
  // it no longer lists instead of leaving them credited forever.
  const nightIds = [...idByNight.values()]
  if (nightIds.length) {
    const { error: dErr } = await sb
      .from('music_night_artists').delete().in('night_id', nightIds)
    if (dErr) return err(`clear lineups: ${dErr.message}`, 500)
  }
  const artistRows = nights.flatMap(n => {
    const id = idByNight.get(n.key)
    if (!id) return []
    // The SAME function the algorithm used, not a copy of its arithmetic — a
    // second implementation here would silently drift from HEADLINER_SHARE and
    // the stored weights would stop explaining the stored scores.
    const shares = creditShares(n.artists)
    return n.artists.map((a, i) => ({
      night_id: id,
      ra_artist_id: a.raArtistId,
      weight: Number((shares[i] ?? 0).toFixed(4)),
      billing: a.billing ?? null,
      role: (shares[i] ?? 0) >= HEADLINER_SHARE && n.artists.length > 1
        ? 'headliner' : 'billed',
    }))
  }).filter(r => r.weight > 0)
  if (artistRows.length) {
    const { error: aErr } = await sb.from('music_night_artists').insert(artistRows)
    if (aErr) return err(`music_night_artists: ${aErr.message}`, 500)
  }

  const scoreRows = ranking.nights.flatMap(s => {
    const id = idByNight.get(s.key)
    if (!id) return []
    return [{
      night_id: id,
      responses_n: s.responsesN,
      raw_mean: Number(s.rawMean.toFixed(3)),
      weighted_mean: Number(s.weightedMean.toFixed(3)),
      effective_responses: Number(s.effectiveResponses.toFixed(3)),
      response_rate: s.responseRate === null ? null : Number(s.responseRate.toFixed(4)),
      expected: s.expected === null ? null : Number(s.expected.toFixed(3)),
      residual: s.residual === null ? null : Number(s.residual.toFixed(3)),
      scored: s.eligible,
      computed_at,
    }]
  })
  if (scoreRows.length) {
    const { error: scErr } = await sb
      .from('music_night_scores').upsert(scoreRows, { onConflict: 'night_id' })
    if (scErr) return err(`music_night_scores: ${scErr.message}`, 500)
  }

  const baselineRows = [
    { scope: 'global', key: '', value: Number(ranking.baselines.global.toFixed(3)), weight: ranking.baselines.nightsN, computed_at },
    ...Object.entries(ranking.baselines.byClub).map(([k, v]) => ({
      scope: 'club', key: k, value: Number(v.toFixed(3)), weight: 0, computed_at,
    })),
    ...Object.entries(ranking.baselines.byWeekday).map(([k, v]) => ({
      scope: 'weekday', key: String(k), value: Number(v.toFixed(3)), weight: 0, computed_at,
    })),
  ]
  const { error: blErr } = await sb
    .from('music_baselines').upsert(baselineRows, { onConflict: 'scope,key' })
  if (blErr) return err(`music_baselines: ${blErr.message}`, 500)

  if (ranking.djs.length) {
    const djRows = ranking.djs.map(d => ({
      ra_artist_id: d.raArtistId,
      nights_n: d.nightsN,
      venues_n: d.venuesN,
      responses_n: d.responsesN,
      credit: Number(d.credit.toFixed(3)),
      raw_residual: Number(d.rawResidual.toFixed(3)),
      effect: Number(d.effect.toFixed(3)),
      score: d.score === null ? null : Number(d.score.toFixed(2)),
      confidence: d.confidence,
      computed_at,
    }))
    const { error: djErr } = await sb
      .from('dj_music_scores').upsert(djRows, { onConflict: 'ra_artist_id' })
    if (djErr) return err(`dj_music_scores: ${djErr.message}`, 500)
  }

  return ok(summary)
}
