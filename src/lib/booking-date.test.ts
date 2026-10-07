import { describe, expect, it } from 'vitest'
import { resolveBookingDate } from './utils'

// 2026-10-10 02:00 CEST — Saturday morning, still Friday 9 Oct's night.
const SAT_2AM = new Date('2026-10-10T00:00:00Z')

describe('resolveBookingDate', () => {
  it('accepts tonight even after midnight', () => {
    expect(resolveBookingDate('2026-10-09', SAT_2AM)).toBe('2026-10-09')
  })
  it('refuses a night that has already ended', () => {
    expect(resolveBookingDate('2026-10-08', SAT_2AM)).toBeNull()
  })
  it('allows 14 nights ahead, not 15', () => {
    expect(resolveBookingDate('2026-10-23', SAT_2AM)).toBe('2026-10-23')
    expect(resolveBookingDate('2026-10-24', SAT_2AM)).toBeNull()
  })
  it('defaults to the next night when no date is sent', () => {
    expect(resolveBookingDate(undefined, SAT_2AM)).toBe('2026-10-10')
  })
  it('rejects garbage', () => {
    expect(resolveBookingDate('10/10/2026', SAT_2AM)).toBeNull()
    expect(resolveBookingDate('2026-13-45', SAT_2AM)).toBeNull()
  })
})
