import { describe, it, expect } from 'vitest'
import {
  rankDJs, summariseNight, fitBaselines, expectedFor, creditShares, reviewWeight,
  MIN_RESPONSES_PER_NIGHT, SHRINK_K_CREDIT, FAN_REVIEW_WEIGHT, HEADLINER_SHARE,
  type Night, type Review,
} from './dj-score'

// ── helpers ─────────────────────────────────────────────────────────────────

const reviews = (...v: number[]): Review[] => v.map(vibe => ({ vibe }))

let seq = 0
function night(p: {
  club: string
  weekday?: number
  vibes: number[]
  artists: string[] | { id: string; billing?: number }[]
  bookings?: number
  intents?: Review['intent'][]
}): Night {
  const artists = (p.artists as (string | { id: string; billing?: number })[]).map((a, i) =>
    typeof a === 'string'
      ? { raArtistId: a, billing: i }
      : { raArtistId: a.id, billing: a.billing })
  return {
    key: `${p.club}:${seq++}`,
    clubId: p.club,
    weekday: p.weekday ?? 5,
    bookings: p.bookings ?? p.vibes.length,
    reviews: p.vibes.map((vibe, i) => ({ vibe, intent: p.intents?.[i] })),
    artists,
  }
}

/** n nights of the same shape — the volume the model needs to say anything. */
function repeat(n: number, make: () => Night): Night[] {
  return Array.from({ length: n }, make)
}

const find = (r: ReturnType<typeof rankDJs>, id: string) =>
  r.djs.find(d => d.raArtistId === id)!

// ── review weighting ────────────────────────────────────────────────────────

describe('reviewWeight', () => {
  it('discounts a review from someone who came for the DJ', () => {
    expect(reviewWeight({ vibe: 5, intent: 'dj' })).toBe(FAN_REVIEW_WEIGHT)
  })

  it('treats venue-led and unknown intent as a full review', () => {
    expect(reviewWeight({ vibe: 5, intent: 'venue' })).toBe(1)
    expect(reviewWeight({ vibe: 5, intent: 'unknown' })).toBe(1)
    expect(reviewWeight({ vibe: 5 })).toBe(1)
  })
})

describe('summariseNight', () => {
  it('reports the plain mean and the weighted mean separately', () => {
    const s = summariseNight(night({
      club: 'a', vibes: [5, 3], intents: ['dj', undefined], artists: ['x'],
    }))
    expect(s.rawMean).toBe(4)
    // (0.5·5 + 1·3) / 1.5 = 3.667 — the fan's 5 pulls less than the other's 3.
    expect(s.weightedMean).toBeCloseTo(3.667, 3)
    // …and the night is worth 1.5 responses, not 2.
    expect(s.effectiveResponses).toBeCloseTo(1.5, 6)
  })

  it('counts a night of fans as fewer responses than its headcount', () => {
    const fans = summariseNight(night({
      club: 'a', vibes: [5, 5, 5, 5], intents: ['dj', 'dj', 'dj', 'dj'], artists: ['x'],
    }))
    const neutral = summariseNight(night({
      club: 'a', vibes: [5, 5, 5, 5], artists: ['x'],
    }))
    // Identical means — the discount cannot show up there, because the weighted
    // mean is normalised within the night. It shows up in the weight total.
    expect(fans.weightedMean).toBeCloseTo(neutral.weightedMean, 6)
    expect(fans.effectiveResponses).toBeCloseTo(2, 6)
    expect(neutral.effectiveResponses).toBeCloseTo(4, 6)
  })

  it('marks a thin night ineligible and never scores it', () => {
    const thin = summariseNight(night({ club: 'a', vibes: [5, 5], artists: ['x'] }))
    expect(thin.responsesN).toBe(2)
    expect(thin.eligible).toBe(false)
    expect(thin.residual).toBeNull()

    const ok = summariseNight(night({ club: 'a', vibes: [5, 5, 5], artists: ['x'] }))
    expect(ok.eligible).toBe(true)
    expect(MIN_RESPONSES_PER_NIGHT).toBe(3)
  })

  it('reports response rate, or null when the booking count is unknown', () => {
    expect(summariseNight(night({ club: 'a', vibes: [5, 4, 3], bookings: 60, artists: ['x'] })).responseRate)
      .toBeCloseTo(0.05, 6)
    expect(summariseNight(night({ club: 'a', vibes: [5, 4, 3], bookings: 0, artists: ['x'] })).responseRate)
      .toBeNull()
  })

  it('survives a night with no reviews without dividing by zero', () => {
    const s = summariseNight(night({ club: 'a', vibes: [], artists: ['x'] }))
    expect(s.responsesN).toBe(0)
    expect(s.rawMean).toBe(0)
    expect(s.weightedMean).toBe(0)
    expect(s.eligible).toBe(false)
  })
})

// ── credit shares ───────────────────────────────────────────────────────────

describe('creditShares', () => {
  it('gives a solo artist the whole night', () => {
    expect(creditShares([{ raArtistId: 'a' }])).toEqual([1])
  })

  it('gives the top of the bill the headline share and splits the rest', () => {
    const s = creditShares([
      { raArtistId: 'head', billing: 0 },
      { raArtistId: 'sup1', billing: 1 },
      { raArtistId: 'sup2', billing: 2 },
    ])
    expect(s[0]).toBeCloseTo(HEADLINER_SHARE, 6)
    expect(s[1]).toBeCloseTo((1 - HEADLINER_SHARE) / 2, 6)
    expect(s[2]).toBeCloseTo((1 - HEADLINER_SHARE) / 2, 6)
  })

  it('splits equally when the bill has no order', () => {
    const s = creditShares([{ raArtistId: 'a' }, { raArtistId: 'b' }, { raArtistId: 'c' }])
    expect(s).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it('lets co-headliners share one headline slice, not take one each', () => {
    const s = creditShares([
      { raArtistId: 'a', billing: 0 },
      { raArtistId: 'b', billing: 0 },
      { raArtistId: 'c', billing: 1 },
    ])
    expect(s[0]).toBeCloseTo(HEADLINER_SHARE / 2, 6)
    expect(s[1]).toBeCloseTo(HEADLINER_SHARE / 2, 6)
    expect(s[2]).toBeCloseTo(1 - HEADLINER_SHARE, 6)
  })

  it('always sums to exactly one night of credit', () => {
    for (const n of [1, 2, 3, 5, 8, 16]) {
      const billed = Array.from({ length: n }, (_, i) => ({ raArtistId: `a${i}`, billing: i }))
      const flat = Array.from({ length: n }, (_, i) => ({ raArtistId: `a${i}` }))
      expect(creditShares(billed).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
      expect(creditShares(flat).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    }
  })

  it('has nothing to share on an empty bill', () => {
    expect(creditShares([])).toEqual([])
  })
})

// ── baselines ───────────────────────────────────────────────────────────────

describe('fitBaselines', () => {
  it('has no opinion with nothing to fit', () => {
    const b = fitBaselines([])
    expect(b).toEqual({ global: 0, byClub: {}, byWeekday: {}, nightsN: 0 })
  })

  it('ignores nights too thin to be evidence', () => {
    const b = fitBaselines([
      summariseNight(night({ club: 'a', vibes: [1, 1], artists: ['x'] })),
      summariseNight(night({ club: 'a', vibes: [5, 5, 5], artists: ['x'] })),
    ])
    expect(b.nightsN).toBe(1)
    expect(b.global).toBeCloseTo(5, 6)
  })

  it('learns that one room scores higher than another', () => {
    const nights = [
      ...repeat(8, () => night({ club: 'big', vibes: [5, 5, 5, 4], artists: ['x'] })),
      ...repeat(8, () => night({ club: 'small', vibes: [3, 3, 2, 3], artists: ['y'] })),
    ].map(summariseNight)
    const b = fitBaselines(nights)
    expect(b.byClub['big']).toBeGreaterThan(0.5)
    expect(b.byClub['small']).toBeLessThan(-0.5)
    expect(expectedFor(b, 'big', 5)).toBeGreaterThan(expectedFor(b, 'small', 5))
  })

  it('learns that Saturdays score higher than Tuesdays', () => {
    const nights = [
      ...repeat(8, () => night({ club: 'a', weekday: 6, vibes: [5, 5, 4, 5], artists: ['x'] })),
      ...repeat(8, () => night({ club: 'a', weekday: 2, vibes: [3, 2, 3, 3], artists: ['y'] })),
    ].map(summariseNight)
    const b = fitBaselines(nights)
    expect(b.byWeekday[6]).toBeGreaterThan(b.byWeekday[2])
    expect(expectedFor(b, 'a', 6)).toBeGreaterThan(expectedFor(b, 'a', 2))
  })

  it('keeps a club with one night close to the global mean', () => {
    const nights = [
      ...repeat(20, () => night({ club: 'known', vibes: [4, 4, 4], artists: ['x'] })),
      night({ club: 'once', vibes: [1, 1, 1], artists: ['y'] }),
    ].map(summariseNight)
    const b = fitBaselines(nights)
    // Raw, that club's offset would be −3. Shrunk, it must be far smaller: one
    // night is not evidence that a room is three stars worse than everywhere.
    expect(b.byClub['once']).toBeGreaterThan(-1.6)
    expect(b.byClub['once']).toBeLessThan(0)
  })

  it('does not let a room that only opens one weekday swallow that weekday', () => {
    // 'fri-only' plays Fridays exclusively and scores high; another club plays
    // both days. A single-pass fit would load the whole Friday effect onto the
    // club. Two passes must leave a visible Friday offset.
    const nights = [
      ...repeat(10, () => night({ club: 'fri-only', weekday: 5, vibes: [5, 5, 5], artists: ['x'] })),
      ...repeat(10, () => night({ club: 'both', weekday: 5, vibes: [5, 4, 5], artists: ['y'] })),
      ...repeat(10, () => night({ club: 'both', weekday: 2, vibes: [3, 3, 2], artists: ['z'] })),
    ].map(summariseNight)
    const b = fitBaselines(nights)
    expect(b.byWeekday[5]).toBeGreaterThan(b.byWeekday[2])
    expect(b.byWeekday[5] - b.byWeekday[2]).toBeGreaterThan(0.5)
  })
})

// ── the four confounders ────────────────────────────────────────────────────

describe('confounder 1 — venue and weekday must not decide the ranking', () => {
  it('rates a resident stuck with Tuesdays level with a weekend DJ who does as well', () => {
    // Tuesdays at a quiet room run ~3. Saturdays at a big room run ~5. Each DJ
    // scores exactly what their slot is worth — so neither added anything, and
    // the two must come out level despite a two-star gap in raw averages.
    const nights = [
      ...repeat(10, () => night({ club: 'small', weekday: 2, vibes: [3, 3, 3], artists: ['tuesday-resident'] })),
      ...repeat(10, () => night({ club: 'big', weekday: 6, vibes: [5, 5, 5], artists: ['weekend-dj'] })),
    ]
    const r = rankDJs(nights)
    const tue = find(r, 'tuesday-resident')
    const sat = find(r, 'weekend-dj')

    expect(Math.abs(tue.effect)).toBeLessThan(0.15)
    expect(Math.abs(sat.effect)).toBeLessThan(0.15)
    expect(Math.abs(tue.effect - sat.effect)).toBeLessThan(0.15)
  })

  it('still finds the DJ who beats their own room', () => {
    // Same quiet Tuesday room, but this DJ's nights run a star above the rest
    // of it. That is a real signal and must survive.
    const nights = [
      ...repeat(10, () => night({ club: 'small', weekday: 2, vibes: [3, 3, 3], artists: ['ordinary'] })),
      ...repeat(10, () => night({ club: 'small', weekday: 2, vibes: [4, 4, 4], artists: ['overperformer'] })),
    ]
    const r = rankDJs(nights)
    expect(find(r, 'overperformer').effect).toBeGreaterThan(find(r, 'ordinary').effect)
    expect(r.djs[0].raArtistId).toBe('overperformer')
  })
})

describe('confounder 2 — a support act must not inherit the headliner', () => {
  it('credits the headliner more than the warm-up on the same night', () => {
    const nights = repeat(12, () => night({
      club: 'a', vibes: [5, 5, 5],
      artists: [{ id: 'headliner', billing: 0 }, { id: 'warmup', billing: 1 }],
    }))
    // Both need something to be measured against, or every night is average.
    const baseline = repeat(12, () => night({ club: 'a', vibes: [3, 3, 3], artists: ['filler'] }))
    const r = rankDJs([...nights, ...baseline])

    const head = find(r, 'headliner')
    const warm = find(r, 'warmup')
    expect(head.credit).toBeGreaterThan(warm.credit)
    expect(head.effect).toBeGreaterThan(warm.effect)
  })

  it('separates a support act once they play elsewhere on their own', () => {
    // 'rider' only ever appears under a strong headliner; 'earner' plays the
    // same bills but ALSO carries weak nights alone. Their own nights are what
    // pulls them apart.
    const shared = repeat(10, () => night({
      club: 'a', vibes: [5, 5, 5],
      artists: [{ id: 'headliner', billing: 0 }, { id: 'rider', billing: 1 }],
    }))
    const sharedToo = repeat(10, () => night({
      club: 'a', vibes: [5, 5, 5],
      artists: [{ id: 'headliner', billing: 0 }, { id: 'earner', billing: 1 }],
    }))
    const solo = repeat(10, () => night({ club: 'b', vibes: [2, 2, 2], artists: ['earner'] }))
    const filler = repeat(10, () => night({ club: 'b', vibes: [4, 4, 4], artists: ['filler'] }))

    const r = rankDJs([...shared, ...sharedToo, ...solo, ...filler])
    expect(find(r, 'earner').effect).toBeLessThan(find(r, 'rider').effect)
  })
})

describe('confounder 3 — fans must not be able to vote a DJ up on their own', () => {
  it('ranks a DJ carried by fan reviews below one rated by everyone', () => {
    const fanFavourite = repeat(10, () => night({
      club: 'a', vibes: [5, 5, 5, 5],
      intents: ['dj', 'dj', 'dj', 'dj'],
      artists: ['fan-favourite'],
    }))
    const broadlyLiked = repeat(10, () => night({
      club: 'a', vibes: [5, 5, 5, 5],
      intents: [undefined, undefined, undefined, undefined],
      artists: ['broadly-liked'],
    }))
    const filler = repeat(10, () => night({ club: 'a', vibes: [3, 3, 3, 3], artists: ['filler'] }))

    const r = rankDJs([...fanFavourite, ...broadlyLiked, ...filler])
    expect(find(r, 'broadly-liked').effect).toBeGreaterThan(find(r, 'fan-favourite').effect)
  })
})

describe('confounder 4 — thin evidence must not outrank a long record', () => {
  it('puts one perfect night below forty good ones', () => {
    const veteran = repeat(40, () => night({ club: 'a', vibes: [5, 4, 5], artists: ['veteran'] }))
    const oneHit = [night({ club: 'a', vibes: [5, 5, 5], artists: ['one-hit'] })]
    const filler = repeat(20, () => night({ club: 'a', vibes: [3, 3, 3], artists: ['filler'] }))

    const r = rankDJs([...veteran, ...oneHit, ...filler])
    expect(find(r, 'veteran').effect).toBeGreaterThan(find(r, 'one-hit').effect)
    expect(r.djs[0].raArtistId).toBe('veteran')
  })

  it('shrinks harder the less evidence there is', () => {
    const effectWith = (n: number) => {
      const subject = repeat(n, () => night({ club: 'a', vibes: [5, 5, 5], artists: ['subject'] }))
      const filler = repeat(30, () => night({ club: 'a', vibes: [3, 3, 3], artists: ['filler'] }))
      return find(rankDJs([...subject, ...filler]), 'subject').effect
    }
    const e1 = effectWith(1)
    const e5 = effectWith(5)
    const e30 = effectWith(30)
    expect(e1).toBeLessThan(e5)
    expect(e5).toBeLessThan(e30)
  })

  it('never reports an effect larger than the residual it came from', () => {
    // The invariant that makes shrinkage safe: it can only ever pull a signal
    // toward zero, never past it and never amplify it. Checked on every artist
    // in a deliberately lopsided world.
    const r = rankDJs([
      ...repeat(30, () => night({ club: 'a', vibes: [5, 5, 5], artists: ['high'] })),
      ...repeat(2, () => night({ club: 'b', vibes: [5, 5, 5], artists: ['thin'] })),
      ...repeat(30, () => night({ club: 'a', vibes: [1, 1, 1], artists: ['low'] })),
      ...repeat(10, () => night({ club: 'b', vibes: [3, 3, 3], artists: ['mid'] })),
    ])
    expect(r.djs.length).toBeGreaterThan(0)
    for (const d of r.djs) {
      expect(Math.abs(d.effect)).toBeLessThanOrEqual(Math.abs(d.rawResidual) + 1e-9)
      expect(Math.sign(d.effect) === Math.sign(d.rawResidual) || d.effect === 0).toBe(true)
    }
  })

  it('applies the shrinkage law at exactly K effective responses', () => {
    // Mechanical check, independent of the fit: with credit == K the effect is
    // half the raw residual.
    const subject = repeat(4, () => night({ club: 'a', vibes: [5, 5, 5, 5, 5], artists: ['s'] }))
    const filler = repeat(40, () => night({ club: 'a', vibes: [3, 3, 3, 3, 3], artists: ['f'] }))
    const d = find(rankDJs([...subject, ...filler]), 's')
    // 4 nights × 5 responses × full credit = 20 = SHRINK_K_CREDIT.
    expect(d.credit).toBeCloseTo(SHRINK_K_CREDIT, 6)
    expect(d.effect).toBeCloseTo(d.rawResidual / 2, 6)
  })
})

// ── reporting contract ──────────────────────────────────────────────────────

describe('rankDJs reporting', () => {
  it('withholds a score until there is enough evidence, and says why', () => {
    const r = rankDJs([
      ...repeat(2, () => night({ club: 'a', vibes: [5, 5, 5], artists: ['barely-seen'] })),
      ...repeat(10, () => night({ club: 'a', vibes: [3, 3, 3], artists: ['filler'] })),
    ])
    const seen = find(r, 'barely-seen')
    expect(seen.confidence).toBe('none')
    expect(seen.score).toBeNull()
    // …but the row exists, so "we have 2 nights" is distinguishable from
    // "never seen".
    expect(seen.nightsN).toBe(2)
  })

  it('will not score an artist seen at only one venue, however many nights', () => {
    const r = rankDJs([
      ...repeat(30, () => night({ club: 'only-room', vibes: [5, 5, 5], artists: ['one-room'] })),
      ...repeat(30, () => night({ club: 'other', vibes: [3, 3, 3], artists: ['filler'] })),
    ])
    const d = find(r, 'one-room')
    expect(d.venuesN).toBe(1)
    expect(d.confidence).toBe('low')
    expect(d.score).toBeNull()
  })

  it('scores an artist seen widely, on the 1-5 scale', () => {
    const r = rankDJs([
      ...repeat(8, () => night({ club: 'a', vibes: [5, 5, 5], artists: ['travelled'] })),
      ...repeat(8, () => night({ club: 'b', vibes: [5, 5, 5], artists: ['travelled'] })),
      ...repeat(8, () => night({ club: 'c', vibes: [4, 5, 5], artists: ['travelled'] })),
      ...repeat(20, () => night({ club: 'a', vibes: [3, 3, 3], artists: ['filler'] })),
      ...repeat(20, () => night({ club: 'b', vibes: [3, 3, 3], artists: ['filler'] })),
    ])
    const d = find(r, 'travelled')
    expect(d.venuesN).toBe(3)
    expect(d.confidence).toBe('high')
    expect(d.score).not.toBeNull()
    expect(d.score!).toBeGreaterThan(r.baselines.global)
    expect(d.score!).toBeGreaterThanOrEqual(1)
    expect(d.score!).toBeLessThanOrEqual(5)
  })

  it('clamps a score into the star range even on an extreme residual', () => {
    const r = rankDJs([
      ...repeat(30, () => night({ club: 'a', vibes: [5, 5, 5], artists: ['ceiling'] })),
      ...repeat(30, () => night({ club: 'b', vibes: [5, 5, 5], artists: ['ceiling'] })),
      ...repeat(30, () => night({ club: 'c', vibes: [5, 5, 5], artists: ['ceiling'] })),
      ...repeat(30, () => night({ club: 'a', vibes: [1, 1, 1], artists: ['floor'] })),
      ...repeat(30, () => night({ club: 'b', vibes: [1, 1, 1], artists: ['floor'] })),
      ...repeat(30, () => night({ club: 'c', vibes: [1, 1, 1], artists: ['floor'] })),
    ])
    for (const d of r.djs) {
      if (d.score !== null) {
        expect(d.score).toBeGreaterThanOrEqual(1)
        expect(d.score).toBeLessThanOrEqual(5)
      }
    }
  })

  it('is deterministic and totally ordered', () => {
    const build = (): Night[] => {
      seq = 0
      return [
        ...repeat(6, () => night({ club: 'a', vibes: [4, 4, 4], artists: ['x'] })),
        ...repeat(6, () => night({ club: 'a', vibes: [4, 4, 4], artists: ['y'] })),
        ...repeat(6, () => night({ club: 'b', vibes: [4, 4, 4], artists: ['z'] })),
      ]
    }
    const a = rankDJs(build())
    const b = rankDJs(build())
    expect(a.djs.map(d => d.raArtistId)).toEqual(b.djs.map(d => d.raArtistId))
    expect(a.djs.map(d => d.effect)).toEqual(b.djs.map(d => d.effect))
  })

  it('handles an empty world without throwing', () => {
    const r = rankDJs([])
    expect(r.djs).toEqual([])
    expect(r.nights).toEqual([])
    expect(r.baselines.nightsN).toBe(0)
  })

  it('ignores nights with nobody on the bill', () => {
    const r = rankDJs([
      ...repeat(5, () => night({ club: 'a', vibes: [5, 5, 5], artists: [] })),
      ...repeat(5, () => night({ club: 'a', vibes: [3, 3, 3], artists: ['x'] })),
    ])
    expect(r.djs.map(d => d.raArtistId)).toEqual(['x'])
    // The unattributed nights still inform the baseline — they are real nights.
    expect(r.baselines.nightsN).toBe(10)
  })

  it('reflects today\'s data shape: 4 responses total produces no scores at all', () => {
    // The live table had 4 surveys, all 5/5, when this was written. Whatever the
    // maths says, the answer at that volume must be "we do not know".
    const r = rankDJs([
      night({ club: 'ku', vibes: [5, 5, 5], artists: ['x'] }),
      night({ club: 'ku', vibes: [5], artists: ['y'] }),
    ])
    expect(r.djs.every(d => d.score === null)).toBe(true)
  })
})
