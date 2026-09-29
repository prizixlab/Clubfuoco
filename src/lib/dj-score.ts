// How good is a DJ, inferred from how people rated the nights they played.
//
// Nobody rates a DJ. People rate a NIGHT — one "how was the music" star field
// in the morning-after survey — and a night has a venue, a weekday, a crowd and
// usually two names on the bill. Turning that into a per-artist number is a
// credit-assignment problem, and the naive version (average the nights they
// played) measures the wrong thing four different ways:
//
//   1. VENUE AND WEEKDAY DOMINATE. A Saturday at a seafront room out-scores a
//      Tuesday basement whoever is on. A resident handed Tuesdays would rank
//      below a mediocre DJ handed weekends.
//   2. CREDIT IS SHARED. With a median of two artists a night, a support DJ
//      inherits the headliner's score permanently.
//   3. RESPONDERS SELF-SELECT. People who had a bad night don't fill the survey,
//      and some came *for* the DJ. Absolute levels run high and mean little.
//   4. SMALL n OUTRANKS SIGNAL. One glowing night is a 5.0, which beats forty
//      nights at 4.6.
//
// So this module never scores a DJ on a night's level. It scores them on what
// is LEFT OVER once the night is explained:
//
//     night_score ≈ μ + club_offset + weekday_offset + (what the lineup did)
//
// The residual is the last term. Credit for it is split across the bill, summed
// per artist, and then pulled back toward zero in proportion to how little
// evidence there is. A DJ becomes distinguishable from their room and their
// co-bill precisely because they turn up across DIFFERENT rooms, weekdays and
// line-ups — that is what identifies them, and it needs volume, not cleverness.
//
// WHAT THIS DELIBERATELY DOES NOT DO: impute a value for the people who never
// answered. Filling 97 silent bookings with "probably 3 stars" does not remove
// the selection bias, it manufactures data — every low-response night converges
// on the imputed constant, so the output ends up ranking response rate rather
// than music. Response rate is recorded on every night (see `responseRate`) as
// a variable to model once there is enough data to learn its sign, because it
// is genuinely unclear whether quiet feedback means a bad night or a heavy one.
// Until then, shrinkage expresses "we don't know much yet" honestly and
// imputation would not.
//
// Everything here is pure: no Supabase, no network, no clock. The job in
// src/app/api/admin/dj-scores/route.ts does the I/O and calls `rankDJs`.

// ── Tunables ────────────────────────────────────────────────────────────────
// Each of these is a judgement, not a fact. They are exported so the job, the
// tests and any future calibration can see and change them in one place.

/** A night with fewer responses than this is recorded but never scored: the
 *  mean of one or two answers is not a measurement of anything. */
export const MIN_RESPONSES_PER_NIGHT = 3

/** Effective responses at which a DJ's raw residual is trusted halfway.
 *  `effect = credit/(credit + K) × raw`, so K=20 means 20 effective responses
 *  gets 50% of the raw signal, 60 gets 75%, and a single night gets almost
 *  nothing. This is the whole answer to confounder 4. */
export const SHRINK_K_CREDIT = 20

/** Nights at which a club's (or weekday's) own offset is trusted halfway.
 *  Lower than SHRINK_K_CREDIT because there are far fewer clubs than artists
 *  and the venue effect is the largest and most obvious one. */
export const BASELINE_SHRINK_K = 5

/** How much a review counts when the person came specifically for this DJ.
 *  They are not lying — they are answering a different question, closer to "was
 *  I right to come" than "was the music good". Down-weighted rather than
 *  dropped, because discarding the most engaged guests loses real information;
 *  the `intent` flag is also worth keeping as its own signal (draw, not
 *  quality), which is a separate score and not this one. */
export const FAN_REVIEW_WEIGHT = 0.5

/** The top of the bill takes this share of a night's credit; the rest split the
 *  remainder equally. RA lists the bill in billing order, so position 0 is the
 *  headliner. A flat split would let a warm-up act inherit a headliner's night
 *  in full, which is confounder 2.
 *
 *  MUST BE > 0.5, and that is not a style preference: the median bill is TWO
 *  artists, and at exactly 0.5 a two-name night splits 0.5/0.5 — identical to a
 *  flat split, so the headliner weighting would silently do nothing in the most
 *  common case. 0.6 gives 0.6/0.4 on a pair and 0.6/0.2/0.2 on a trio. */
export const HEADLINER_SHARE = 0.6

/** Gates for saying anything out loud. A DJ seen at one venue cannot be told
 *  apart from that venue, however many nights it is — hence the venue counts. */
export const CONFIDENCE_GATES = {
  low:    { nights: 3,  venues: 1, credit: 5 },
  medium: { nights: 5,  venues: 2, credit: 15 },
  high:   { nights: 12, venues: 3, credit: 40 },
} as const

/** Stars are 1–5, so a residual can never mean more than this either way.
 *  Clamped rather than thrown: a wild residual means thin data, which shrinkage
 *  has already handled. */
const SCORE_MIN = 1
const SCORE_MAX = 5

// ── Inputs ──────────────────────────────────────────────────────────────────

export type ReviewIntent = 'dj' | 'venue' | 'unknown'

export interface Review {
  /** `booking_surveys.vibe_rating`, 1–5. */
  vibe: number
  /** How the booking was made. 'dj' means they arrived via a DJ's page or
   *  booked a night that artist headlined — see confounder 3. Absent or
   *  'unknown' is treated as a normal review, which is the safe default while
   *  the booking flow does not yet record the referring surface. */
  intent?: ReviewIntent
}

export interface NightArtist {
  /** `djs.ra_artist_id` — the id from `events.lineup[].id`, or a synthetic
   *  `guest:<name>` for artists who are not in the RA catalogue. */
  raArtistId: string
  /** Position on the bill, 0 = top. Omitted means "unbilled/unknown", which is
   *  treated as an equal split (see `creditShares`). */
  billing?: number
}

export interface Night {
  /** Stable identifier — the job passes `${clubId}:${date}`. */
  key: string
  clubId: string
  /** 0 = Sunday … 6 = Saturday, matching `Date#getUTCDay`. */
  weekday: number
  /** Bookings recorded for this night: the denominator for response rate. May
   *  be 0 for a night reconstructed from surveys alone, in which case the rate
   *  is null rather than infinite. */
  bookings: number
  reviews: Review[]
  artists: NightArtist[]
}

// ── Outputs ─────────────────────────────────────────────────────────────────

export interface NightSummary {
  key: string
  clubId: string
  weekday: number
  responsesN: number
  /** Plain mean of `vibe`, kept for reporting so the weighting is auditable. */
  rawMean: number
  /** Review-weighted mean — what the model actually consumes. */
  weightedMean: number
  /** Σ of the review weights: how many *full-strength* responses this night is
   *  worth. This, not `responsesN`, is how much the night counts toward
   *  baselines and toward an artist's credit.
   *
   *  It has to be separate, because `weightedMean` is normalised WITHIN the
   *  night — four reviews all from people who came for the DJ average to the
   *  same number as four neutral ones, so down-weighting them changes nothing
   *  on its own. Carrying the weight total is what actually makes a night of
   *  fans count for less: four fan reviews are worth two responses, so the
   *  artist accrues half the credit and is shrunk twice as hard. */
  effectiveResponses: number
  /** responses / bookings, or null when the booking count is unknown. Recorded
   *  and NOT used in the fit; see the note at the top of this file. */
  responseRate: number | null
  /** False when below MIN_RESPONSES_PER_NIGHT: summarised but not scored. */
  eligible: boolean
  /** μ + club + weekday. Null for ineligible nights. */
  expected: number | null
  /** weightedMean − expected. Null for ineligible nights. */
  residual: number | null
}

export interface Baselines {
  /** Response-weighted grand mean across eligible nights. */
  global: number
  /** Per-club offsets from `global`, shrunk toward 0. */
  byClub: Record<string, number>
  /** Per-weekday offsets, shrunk toward 0, fitted on club-adjusted residuals. */
  byWeekday: Record<number, number>
  /** Eligible nights that went into the fit. */
  nightsN: number
}

export type Confidence = 'none' | 'low' | 'medium' | 'high'

export interface DJScore {
  raArtistId: string
  /** Distinct eligible nights this artist was credited on. */
  nightsN: number
  /** Distinct clubs — the guard against mistaking a room for an artist. */
  venuesN: number
  /** Raw responses across those nights (not credit-adjusted). */
  responsesN: number
  /** Σ(credit share × responses) — effective responses attributable here. */
  credit: number
  /** Credit-weighted mean residual, before shrinkage. */
  rawResidual: number
  /** After shrinkage toward 0. This is the ranking key. */
  effect: number
  /** `global + effect` on the familiar 1–5 scale, or null below `medium`
   *  confidence. Null means "we do not know yet" — never 0, never a guess. */
  score: number | null
  confidence: Confidence
}

export interface Ranking {
  baselines: Baselines
  nights: NightSummary[]
  djs: DJScore[]
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** How much one review counts. See FAN_REVIEW_WEIGHT. */
export function reviewWeight(r: Review): number {
  return r.intent === 'dj' ? FAN_REVIEW_WEIGHT : 1
}

/**
 * Credit shares for one night's bill, always summing to 1 (or empty for an
 * empty bill). The top of the bill takes HEADLINER_SHARE; everyone else splits
 * the rest. With no billing information the split is equal, because guessing an
 * order we do not have would invent a hierarchy.
 */
export function creditShares(artists: NightArtist[]): number[] {
  const n = artists.length
  if (n === 0) return []
  if (n === 1) return [1]

  const billed = artists.some(a => typeof a.billing === 'number')
  if (!billed) return artists.map(() => 1 / n)

  // Lowest billing number is the top of the bill. Ties (two co-headliners at
  // position 0) share the headline slice between them rather than each taking
  // a full one, so the night's credit still sums to 1.
  const top = Math.min(...artists.map(a => a.billing ?? Number.MAX_SAFE_INTEGER))
  const heads = artists.filter(a => (a.billing ?? Number.MAX_SAFE_INTEGER) === top).length
  const rest = n - heads
  return artists.map(a => {
    const isHead = (a.billing ?? Number.MAX_SAFE_INTEGER) === top
    if (isHead) return HEADLINER_SHARE / heads
    return rest > 0 ? (1 - HEADLINER_SHARE) / rest : 0
  })
}

/** Mean, weighted-mean and response rate for one night. No baselines yet. */
export function summariseNight(night: Night): NightSummary {
  const reviews = night.reviews.filter(r => Number.isFinite(r.vibe))
  const responsesN = reviews.length

  let wSum = 0
  let wvSum = 0
  let vSum = 0
  for (const r of reviews) {
    const w = reviewWeight(r)
    wSum += w
    wvSum += w * r.vibe
    vSum += r.vibe
  }

  return {
    key: night.key,
    clubId: night.clubId,
    weekday: night.weekday,
    responsesN,
    rawMean: responsesN ? vSum / responsesN : 0,
    // wSum can only be 0 when there are no reviews at all, since every weight
    // is > 0 — so this never divides by zero for a night with responses.
    weightedMean: wSum > 0 ? wvSum / wSum : 0,
    effectiveResponses: wSum,
    responseRate: night.bookings > 0 ? responsesN / night.bookings : null,
    eligible: responsesN >= MIN_RESPONSES_PER_NIGHT,
    expected: null,
    residual: null,
  }
}

/** Shrink a group's own mean toward a prior by how much evidence it has. */
function shrink(mean: number, n: number, prior: number, k: number): number {
  if (n <= 0) return prior
  const trust = n / (n + k)
  return prior + trust * (mean - prior)
}

/**
 * Fit μ, per-club offsets and per-weekday offsets from the eligible nights.
 *
 * Two alternating passes rather than a single one: weekday offsets are fitted
 * on club-adjusted residuals, then club offsets are re-fitted with the weekday
 * offsets in hand. One pass is enough when the two are uncorrelated, but they
 * are not — a room that only opens Fridays would otherwise absorb the whole
 * Friday effect into its own offset. Two passes is cheap and materially better;
 * more passes move the numbers very little at this data size.
 *
 * Nights are weighted by their EFFECTIVE response count throughout (see
 * NightSummary.effectiveResponses), so a night with twenty answers informs the
 * baseline more than one with three, and a night answered only by the artist's
 * own fans informs it less than its headcount suggests.
 */
export function fitBaselines(summaries: NightSummary[], passes = 2): Baselines {
  const eligible = summaries.filter(s => s.eligible)
  if (eligible.length === 0) {
    return { global: 0, byClub: {}, byWeekday: {}, nightsN: 0 }
  }

  const totalW = eligible.reduce((a, s) => a + s.effectiveResponses, 0)
  const global = eligible.reduce((a, s) => a + s.effectiveResponses * s.weightedMean, 0) / totalW

  let byClub: Record<string, number> = {}
  let byWeekday: Record<number, number> = {}

  for (let pass = 0; pass < Math.max(1, passes); pass++) {
    // Club offsets, holding the current weekday offsets fixed.
    const clubAcc: Record<string, { w: number; sum: number }> = {}
    for (const s of eligible) {
      const target = s.weightedMean - global - (byWeekday[s.weekday] ?? 0)
      const acc = (clubAcc[s.clubId] ??= { w: 0, sum: 0 })
      acc.w += s.effectiveResponses
      acc.sum += s.effectiveResponses * target
    }
    byClub = {}
    for (const [club, acc] of Object.entries(clubAcc)) {
      byClub[club] = shrink(acc.sum / acc.w, acc.w, 0, BASELINE_SHRINK_K)
    }

    // Weekday offsets, holding the club offsets just fitted.
    const wdAcc: Record<number, { w: number; sum: number }> = {}
    for (const s of eligible) {
      const target = s.weightedMean - global - (byClub[s.clubId] ?? 0)
      const acc = (wdAcc[s.weekday] ??= { w: 0, sum: 0 })
      acc.w += s.effectiveResponses
      acc.sum += s.effectiveResponses * target
    }
    byWeekday = {}
    for (const [wd, acc] of Object.entries(wdAcc)) {
      byWeekday[Number(wd)] = shrink(acc.sum / acc.w, acc.w, 0, BASELINE_SHRINK_K)
    }
  }

  return { global, byClub, byWeekday, nightsN: eligible.length }
}

/** What a night at this club on this weekday is expected to score. */
export function expectedFor(b: Baselines, clubId: string, weekday: number): number {
  return b.global + (b.byClub[clubId] ?? 0) + (b.byWeekday[weekday] ?? 0)
}

function confidenceFor(nightsN: number, venuesN: number, credit: number): Confidence {
  const meets = (g: { nights: number; venues: number; credit: number }) =>
    nightsN >= g.nights && venuesN >= g.venues && credit >= g.credit
  if (meets(CONFIDENCE_GATES.high)) return 'high'
  if (meets(CONFIDENCE_GATES.medium)) return 'medium'
  if (meets(CONFIDENCE_GATES.low)) return 'low'
  return 'none'
}

/**
 * The whole pipeline: summarise nights, fit baselines, attribute residuals,
 * shrink, rank. Deterministic and side-effect free — same input, same output.
 *
 * Returns every artist seen on an eligible night, including the ones with no
 * usable signal. A caller showing a leaderboard should filter on `confidence`;
 * the rows are all here so the job can store them and so "we have 2 nights on
 * this artist" is visible rather than indistinguishable from "never seen".
 */
export function rankDJs(nights: Night[]): Ranking {
  const summaries = nights.map(summariseNight)
  const baselines = fitBaselines(summaries)

  // Attach expected/residual to the eligible summaries.
  const byKey = new Map<string, NightSummary>()
  for (const s of summaries) {
    if (s.eligible) {
      s.expected = expectedFor(baselines, s.clubId, s.weekday)
      s.residual = s.weightedMean - s.expected
    }
    byKey.set(s.key, s)
  }

  interface Acc {
    credit: number
    weighted: number
    responsesN: number
    nights: Set<string>
    venues: Set<string>
  }
  const acc = new Map<string, Acc>()

  for (const night of nights) {
    const s = byKey.get(night.key)
    if (!s?.eligible || s.residual === null) continue

    const shares = creditShares(night.artists)
    night.artists.forEach((artist, i) => {
      const share = shares[i] ?? 0
      if (share <= 0) return
      const a = acc.get(artist.raArtistId) ?? {
        credit: 0, weighted: 0, responsesN: 0, nights: new Set(), venues: new Set(),
      }
      // Credit is share × responses, so a well-attended night counts for more
      // than a thin one AND a headline slot counts for more than a warm-up.
      const w = share * s.effectiveResponses
      a.credit += w
      a.weighted += w * s.residual!
      a.responsesN += s.responsesN
      a.nights.add(night.key)
      a.venues.add(night.clubId)
      acc.set(artist.raArtistId, a)
    })
  }

  const djs: DJScore[] = []
  for (const [raArtistId, a] of acc) {
    const rawResidual = a.credit > 0 ? a.weighted / a.credit : 0
    const effect = (a.credit / (a.credit + SHRINK_K_CREDIT)) * rawResidual
    const confidence = confidenceFor(a.nights.size, a.venues.size, a.credit)
    const scoreable = confidence === 'medium' || confidence === 'high'
    djs.push({
      raArtistId,
      nightsN: a.nights.size,
      venuesN: a.venues.size,
      responsesN: a.responsesN,
      credit: a.credit,
      rawResidual,
      effect,
      score: scoreable
        ? Math.min(SCORE_MAX, Math.max(SCORE_MIN, baselines.global + effect))
        : null,
      confidence,
    })
  }

  // Best first; ties broken by evidence, then id so the order is total and
  // stable (two artists with identical effects must not swap between runs).
  djs.sort((x, y) =>
    y.effect - x.effect ||
    y.credit - x.credit ||
    x.raArtistId.localeCompare(y.raArtistId))

  return { baselines, nights: summaries, djs }
}
