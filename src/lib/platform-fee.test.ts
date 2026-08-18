import { describe, it, expect } from 'vitest'
import {
  platformFeeCents, promoterTakeCents, formatFeeBps, parseFeePercent,
  DEFAULT_PLATFORM_FEE_BPS, FeeError,
} from './platform-fee'

describe('platformFeeCents', () => {
  it('takes 12% by default', () => {
    expect(platformFeeCents(1000, DEFAULT_PLATFORM_FEE_BPS)).toBe(120)
    expect(platformFeeCents(2500, DEFAULT_PLATFORM_FEE_BPS)).toBe(300)
  })

  it('rounds DOWN, so the odd cent goes to the promoter', () => {
    // 12% of €10.05 is 120.6 cents. Rounding up would take a cent off them.
    expect(platformFeeCents(1005, 1200)).toBe(120)
    expect(promoterTakeCents(1005, 1200)).toBe(885)
    // …and 885 + 120 = 1005: nothing is invented or lost.
    expect(platformFeeCents(1005, 1200) + promoterTakeCents(1005, 1200)).toBe(1005)
  })

  it('never loses or creates a cent, across the whole range', () => {
    for (let amount = 0; amount <= 20_000; amount += 37) {
      for (const bps of [0, 250, 750, 1200, 3333, 10_000]) {
        const fee = platformFeeCents(amount, bps)
        const take = promoterTakeCents(amount, bps)
        expect(fee + take).toBe(amount)
        expect(fee).toBeGreaterThanOrEqual(0)
        expect(take).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('handles a negotiated 0% — the promoter keeps everything', () => {
    expect(platformFeeCents(5000, 0)).toBe(0)
    expect(promoterTakeCents(5000, 0)).toBe(5000)
  })

  it('handles fractional rates a deal might actually use', () => {
    expect(platformFeeCents(10_000, 750)).toBe(750)   // 7.5% of €100
    expect(platformFeeCents(3300, 750)).toBe(247)     // 7.5% of €33 = 247.5 → 247
  })

  it('is zero on a free spot', () => {
    expect(platformFeeCents(0, 1200)).toBe(0)
  })

  it('throws rather than guessing at nonsense', () => {
    // Failing here is loud and early; the alternative is charging a guest a
    // plausible-looking wrong number.
    expect(() => platformFeeCents(-1, 1200)).toThrow(FeeError)
    expect(() => platformFeeCents(10.5, 1200)).toThrow(FeeError)
    expect(() => platformFeeCents(1000, 10_001)).toThrow(FeeError)
    expect(() => platformFeeCents(1000, -1)).toThrow(FeeError)
  })
})

describe('parseFeePercent', () => {
  it('reads what someone types into the portal', () => {
    expect(parseFeePercent('12')).toBe(1200)
    expect(parseFeePercent('12%')).toBe(1200)
    expect(parseFeePercent(' 7.5 ')).toBe(750)
    expect(parseFeePercent('0')).toBe(0)
    expect(parseFeePercent('100')).toBe(10_000)
  })

  it('survives float multiplication', () => {
    // 7.5 * 100 === 750.0000000000001 in IEEE-754 without the rounding.
    expect(Number.isInteger(parseFeePercent('7.5'))).toBe(true)
    expect(parseFeePercent('2.9')).toBe(290)
    expect(parseFeePercent('0.01')).toBe(1)
  })

  it('refuses anything that is not a rate', () => {
    expect(parseFeePercent('')).toBeNull()
    expect(parseFeePercent('abc')).toBeNull()
    expect(parseFeePercent('-5')).toBeNull()
    expect(parseFeePercent('101')).toBeNull()
    expect(parseFeePercent('12.345')).toBeNull()   // finer than the bps grid
    expect(parseFeePercent('1e2')).toBeNull()
  })
})

describe('formatFeeBps', () => {
  it('reads back the way a deal is written', () => {
    expect(formatFeeBps(1200)).toBe('12%')
    expect(formatFeeBps(750)).toBe('7.5%')
    expect(formatFeeBps(0)).toBe('0%')
    expect(formatFeeBps(1)).toBe('0.01%')
  })

  it('round-trips through the parser', () => {
    for (const bps of [0, 1, 250, 750, 1200, 2999, 10_000]) {
      expect(parseFeePercent(formatFeeBps(bps))).toBe(bps)
    }
  })
})
