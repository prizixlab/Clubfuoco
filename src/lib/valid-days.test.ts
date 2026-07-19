import { describe, expect, it } from 'vitest'
import { ALL_DAYS, offerLiveOn, parseValidDays, validDaysInclude, weekdayOf } from './valid-days'

// Mirrors ValidDays.runSelfChecks() in the Swift parser — the two
// implementations must agree, so every Swift self-check appears here too.

const days = (...d: number[]) => new Set(d)
const all = new Set(ALL_DAYS)

describe('parseValidDays — canonical picker strings', () => {
  it('matches "Every night" exactly', () => {
    expect(parseValidDays('Every night')).toEqual(all)
  })
  it('parses an exact comma list of 3-letter abbreviations', () => {
    expect(parseValidDays('Mon, Tue, Sun')).toEqual(days(1, 2, 0))
    expect(parseValidDays('Fri')).toEqual(days(5))
  })
})

describe('parseValidDays — legacy all-week phrases', () => {
  it.each(['every night!', 'Any night', 'Daily', 'All week', '7 nights a week'])(
    '"%s" means all seven', input => {
      expect(parseValidDays(input)).toEqual(all)
    })
})

describe('parseValidDays — weekends / weekdays', () => {
  it('weekends are Fri & Sat (nightlife sense)', () => {
    expect(parseValidDays('Weekends')).toEqual(days(5, 6))
  })
  it('weekdays are their complement', () => {
    expect(parseValidDays('Weekdays')).toEqual(days(0, 1, 2, 3, 4))
  })
})

describe('parseValidDays — free-form lists', () => {
  it('handles "&" and full day names with plural s', () => {
    expect(parseValidDays('Fridays & Saturdays')).toEqual(days(5, 6))
  })
  it('handles "and", slash, plus and semicolon separators', () => {
    expect(parseValidDays('Mon and Wed')).toEqual(days(1, 3))
    expect(parseValidDays('Tue/Thu')).toEqual(days(2, 4))
    expect(parseValidDays('Mon + Fri')).toEqual(days(1, 5))
    expect(parseValidDays('Wed; Sun')).toEqual(days(3, 0))
  })
  it('matches single full day names ("Tuesdays")', () => {
    expect(parseValidDays('Tuesdays')).toEqual(days(2))
  })
})

describe('parseValidDays — ranges', () => {
  it('expands hyphen ranges', () => {
    expect(parseValidDays('Thu - Sun')).toEqual(days(4, 5, 6, 0))
  })
  it('expands en dash ranges', () => {
    expect(parseValidDays('Thu – Sun')).toEqual(days(4, 5, 6, 0))
  })
  it('expands em dash ranges with full names', () => {
    expect(parseValidDays('Thursday — Sunday')).toEqual(days(4, 5, 6, 0))
  })
  it('supports "to" / "through" / "thru" as range words', () => {
    expect(parseValidDays('Fri to Sat')).toEqual(days(5, 6))
    expect(parseValidDays('Mon through Wed')).toEqual(days(1, 2, 3))
    expect(parseValidDays('Mon thru Wed')).toEqual(days(1, 2, 3))
  })
  it('wraps past Saturday', () => {
    expect(parseValidDays('Sat - Mon')).toEqual(days(6, 0, 1))
  })
  it('mixes ranges and lists', () => {
    expect(parseValidDays('Mon-Wed, Fri')).toEqual(days(1, 2, 3, 5))
    expect(parseValidDays('Tue, Thu – Sun')).toEqual(days(2, 4, 5, 6, 0))
  })
  it('parses the legacy static-map default "Sun – Fri"', () => {
    expect(parseValidDays('Sun – Fri')).toEqual(days(0, 1, 2, 3, 4, 5))
  })
})

describe('parseValidDays — unparseable input', () => {
  it('yields the empty set, never a crash', () => {
    expect(parseValidDays('')).toEqual(days())
    expect(parseValidDays('closed')).toEqual(days())
    expect(parseValidDays('   ')).toEqual(days())
  })
})

describe('weekdayOf', () => {
  it('computes known weekdays (0=Sun…6=Sat)', () => {
    expect(weekdayOf('2026-07-18')).toBe(6)  // Saturday
    expect(weekdayOf('2026-07-19')).toBe(0)  // Sunday
    expect(weekdayOf('2026-07-20')).toBe(1)  // Monday
    expect(weekdayOf('2024-02-29')).toBe(4)  // leap day, Thursday
  })
  it('rejects malformed input', () => {
    expect(weekdayOf('tomorrow')).toBeNull()
    expect(weekdayOf('2026-13-01')).toBeNull()
    expect(weekdayOf('')).toBeNull()
  })
})

describe('validDaysInclude / offerLiveOn', () => {
  it('a "Sun – Fri" offer is NOT live on a Saturday', () => {
    expect(validDaysInclude('Sun – Fri', '2026-07-18')).toBe(false)
    expect(offerLiveOn({ valid_days: 'Sun – Fri' }, '2026-07-18')).toBe(false)
  })
  it('is live on a covered weekday', () => {
    expect(offerLiveOn({ valid_days: 'Sun – Fri' }, '2026-07-19')).toBe(true)
  })
  it('a skipped date turns one night off without touching the rest', () => {
    const offer = { valid_days: 'Every night', skipped_dates: ['2026-07-20'] }
    expect(offerLiveOn(offer, '2026-07-20')).toBe(false)
    expect(offerLiveOn(offer, '2026-07-21')).toBe(true)
  })
  it('an archived offer is never live', () => {
    expect(offerLiveOn({ valid_days: 'Every night', is_active: false }, '2026-07-19')).toBe(false)
  })
  it('a missing is_active flag reads as active (server already filtered)', () => {
    expect(offerLiveOn({ valid_days: 'Every night' }, '2026-07-19')).toBe(true)
  })
  it('unparseable valid_days means not live, not always-live', () => {
    expect(offerLiveOn({ valid_days: 'closed' }, '2026-07-19')).toBe(false)
  })
})
