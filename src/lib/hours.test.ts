import { describe, expect, it } from 'vitest'
import { venueWallClockToInstant, bookingWindow } from './hours'

// The check-in window is anchored to Europe/Madrid, NOT UTC. The old code
// stamped local clock minutes onto a UTC midnight, so a "22:00" open resolved
// to 22:00 UTC = 00:00 Madrid in summer — starting the accept-window 2h late and
// 409'ing genuine early-night arrivals. These lock the timezone + DST fix.

describe('venueWallClockToInstant', () => {
  it('resolves summer wall-clock in CEST (UTC+2)', () => {
    // 22:00 Madrid on an August night = 20:00 UTC.
    expect(venueWallClockToInstant('2026-08-15', 22 * 60, false).toISOString())
      .toBe('2026-08-15T20:00:00.000Z')
  })

  it('resolves winter wall-clock in CET (UTC+1)', () => {
    // 22:00 Madrid on a January night = 21:00 UTC.
    expect(venueWallClockToInstant('2026-01-15', 22 * 60, false).toISOString())
      .toBe('2026-01-15T21:00:00.000Z')
  })

  it('rolls a cross-midnight close into the next day', () => {
    // 04:00 the morning after 15 Aug, Madrid = 02:00 UTC on the 16th.
    expect(venueWallClockToInstant('2026-08-15', 4 * 60, true).toISOString())
      .toBe('2026-08-16T02:00:00.000Z')
  })
})

describe('bookingWindow', () => {
  it('anchors open→close to Madrid (fallback hours 17:00→03:00)', () => {
    // No opening_hours → nightWindowFor fallback 17:00→03:00 (+1 day).
    const { earliest, latest } = bookingWindow('2026-08-15', null, null, 'user_checkin')
    // 17:00 Madrid summer = 15:00 UTC; 03:00 next-day Madrid = 01:00 UTC on 16th.
    expect(earliest.toISOString()).toBe('2026-08-15T15:00:00.000Z')
    expect(latest.toISOString()).toBe('2026-08-16T01:00:00.000Z')
  })

  it('accepts an early-night arrival that the old UTC window rejected', () => {
    const { earliest, latest } = bookingWindow('2026-08-15', null, null, 'user_checkin')
    // 22:30 Madrid = 20:30 UTC — comfortably inside 15:00–01:00 UTC now.
    const arrival = new Date('2026-08-15T20:30:00.000Z')
    expect(arrival >= earliest && arrival <= latest).toBe(true)
  })

  it('extends the tail two weeks for post-entry answers', () => {
    const night = bookingWindow('2026-08-15', null, null, 'user_checkin')
    const post = bookingWindow('2026-08-15', null, null, 'post_entry_got_in')
    expect(post.earliest.toISOString()).toBe(night.earliest.toISOString())
    expect(post.latest.getTime()).toBeGreaterThan(night.latest.getTime())
  })
})
