import { describe, it, expect } from 'vitest'
import { generateDoorCode, normalizeDoorCode, sessionExpiry } from './door-events'

// The alphabet excludes every character that gets misread off a phone screen
// in the dark. A door team types this by hand, in a queue, at 1am.
const AMBIGUOUS = ['0', 'O', '1', 'I', 'L']

describe('generateDoorCode', () => {
  it('is six characters', () => {
    for (let i = 0; i < 200; i++) expect(generateDoorCode()).toHaveLength(6)
  })

  it('never emits an ambiguous character', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateDoorCode()
      for (const c of AMBIGUOUS) expect(code).not.toContain(c)
    }
  })

  it('uses the whole alphabet rather than a biased slice', () => {
    // Rejection sampling exists so `% 31` doesn't make the first eight symbols
    // more likely. 3000 codes is 18000 characters over 31 symbols — every one
    // should appear, and none should run away with it.
    const seen = new Map<string, number>()
    for (let i = 0; i < 3000; i++) {
      for (const c of generateDoorCode()) seen.set(c, (seen.get(c) ?? 0) + 1)
    }
    expect(seen.size).toBe(31)
    const counts = [...seen.values()]
    const expected = 18_000 / 31
    // A modulo-biased generator would make eight symbols ~33% more frequent
    // than the rest; ±35% catches that while tolerating ordinary variance.
    expect(Math.min(...counts)).toBeGreaterThan(expected * 0.65)
    expect(Math.max(...counts)).toBeLessThan(expected * 1.35)
  })

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateDoorCode))
    expect(codes.size).toBe(2000)
  })
})

describe('normalizeDoorCode', () => {
  it('accepts what a bouncer actually types', () => {
    expect(normalizeDoorCode(' k7m2 x9 ')).toBe('K7M2X9')
    expect(normalizeDoorCode('K7M-2X9')).toBe('K7M2X9')
    expect(normalizeDoorCode('k7m2x9\n')).toBe('K7M2X9')
  })

  it('leaves ambiguous characters alone rather than guessing', () => {
    // They are absent from the alphabet, so a typed O is not a misread of 0 —
    // it is simply not a valid code, and silently rewriting it would turn a
    // typo into a lookup against someone else's event.
    expect(normalizeDoorCode('O0IL1X')).toBe('O0IL1X')
  })

  it('rejects the empty and the overlong through length, not by throwing', () => {
    expect(normalizeDoorCode('')).toBe('')
    expect(normalizeDoorCode('!!!')).toBe('')
  })
})

describe('sessionExpiry', () => {
  it('carries a 6am close over to the next morning', () => {
    // A night on the 19th closing at 06:00 ends on the 20th. Reading it as
    // 06:00 on the 19th would expire the session sixteen hours before the
    // door opened.
    const exp = sessionExpiry('2026-08-19', '06:00:00')
    expect(exp.toISOString()).toBe('2026-08-20T18:00:00.000Z')
  })

  it('keeps an afternoon close on the same day', () => {
    const exp = sessionExpiry('2026-08-19', '14:00:00')
    expect(exp.toISOString()).toBe('2026-08-20T02:00:00.000Z')
  })

  it('defaults to a 6am close when the night has no close time', () => {
    expect(sessionExpiry('2026-08-19', null).toISOString())
      .toBe(sessionExpiry('2026-08-19', '06:00:00').toISOString())
  })

  it('always lands after the night it belongs to', () => {
    for (const close of [null, '02:00:00', '05:30:00', '11:59:00', '23:00:00']) {
      const exp = sessionExpiry('2026-08-19', close)
      expect(exp.getTime()).toBeGreaterThan(new Date('2026-08-19T23:59:59Z').getTime())
    }
  })

  it('gives a door at least the 12-hour ceiling past closing', () => {
    const close = new Date('2026-08-20T06:00:00Z')      // the 19th, 6am close
    const exp = sessionExpiry('2026-08-19', '06:00:00')
    expect(exp.getTime() - close.getTime()).toBe(12 * 3600 * 1000)
  })
})
