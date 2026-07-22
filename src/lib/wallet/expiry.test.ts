import { describe, expect, it } from 'vitest'
import { madridISO, nightPassDates, passExpiration, passRelevantDate } from './expiry'

describe('madridISO — DST-correct offsets', () => {
  it('uses +02:00 in summer', () => {
    expect(madridISO('2026-07-25', 8)).toBe('2026-07-25T08:00:00+02:00')
  })
  it('uses +01:00 in winter', () => {
    expect(madridISO('2026-01-15', 8)).toBe('2026-01-15T08:00:00+01:00')
  })
  it('rolls the calendar day with dayOffset, including across a month end', () => {
    expect(madridISO('2026-07-31', 8, 0, 1)).toBe('2026-08-01T08:00:00+02:00')
  })
  it('rolls across a year end', () => {
    expect(madridISO('2026-12-31', 8, 0, 1)).toBe('2027-01-01T08:00:00+01:00')
  })
  it('handles a leap day', () => {
    expect(madridISO('2028-02-28', 8, 0, 1)).toBe('2028-02-29T08:00:00+01:00')
  })
  it('accepts a full timestamp and uses only the calendar day', () => {
    expect(madridISO('2026-07-25T23:30:00.000Z', 8)).toBe('2026-07-25T08:00:00+02:00')
  })
  it('returns null for junk rather than an invalid date', () => {
    expect(madridISO('', 8)).toBeNull()
    expect(madridISO('tomorrow', 8)).toBeNull()
  })
})

describe('passExpiration — the morning after', () => {
  it('expires at 08:00 the day AFTER the night', () => {
    // A Saturday-night pass must survive a 06:00 closing time.
    expect(passExpiration('2026-07-25')).toBe('2026-07-26T08:00:00+02:00')
  })
  it('is null when the date is missing, so no pass expires by accident', () => {
    expect(passExpiration(null)).toBeNull()
    expect(passExpiration(undefined)).toBeNull()
  })
})

describe('passRelevantDate', () => {
  it('surfaces the pass on the evening of the night itself', () => {
    expect(passRelevantDate('2026-07-25')).toBe('2026-07-25T20:00:00+02:00')
  })
})

describe('nightPassDates', () => {
  it('produces both keys for a valid date', () => {
    expect(nightPassDates('2026-07-25')).toEqual({
      expirationDate: '2026-07-26T08:00:00+02:00',
      relevantDate:   '2026-07-25T20:00:00+02:00',
    })
  })

  it('produces NO keys for a bad date — never an already-expired pass', () => {
    // Spreading {} leaves pass.json exactly as it was before this feature.
    expect(nightPassDates(null)).toEqual({})
    expect(nightPassDates('not a date')).toEqual({})
  })

  it('expiration is always after the relevant date', () => {
    const { expirationDate, relevantDate } = nightPassDates('2026-07-25')
    expect(new Date(expirationDate!).getTime()).toBeGreaterThan(new Date(relevantDate!).getTime())
  })
})
