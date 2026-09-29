import { describe, it, expect } from 'vitest'
import { doorPriceLabel, doorPriceOn } from '@/lib/door-price'

const c = (
  door_price_min: number | string | null,
  door_price_max: number | string | null = null,
  door_price_weekend_min: number | string | null = null,
  door_price_weekend_max: number | string | null = null,
) => ({ door_price_min, door_price_max, door_price_weekend_min, door_price_weekend_max })

describe('doorPriceLabel', () => {
  it('a flat price is one number — Sutton, Opium, Bling Bling', () => {
    expect(doorPriceLabel(c(20))).toBe('€20')
  })

  it('a weekday range plus a weekend range — Downtown', () => {
    expect(doorPriceLabel(c(15, 20, 22, 25))).toBe('€15–20 · €22–25 weekends')
  })

  it('one currency mark across a range, not two', () => {
    expect(doorPriceLabel(c(15, 20))).toBe('€15–20')
  })

  it('numeric(7,2) arrives as a string from PostgREST', () => {
    expect(doorPriceLabel(c('15.00', '20.00', '22.00', '25.00')))
      .toBe('€15–20 · €22–25 weekends')
  })

  it('keeps real cents, drops trailing .00', () => {
    expect(doorPriceLabel(c('12.50'))).toBe('€12.50')
  })

  it('free all week', () => {
    expect(doorPriceLabel(c(0))).toBe('Free')
  })

  it('free midweek but priced at the weekend is NOT just "Free"', () => {
    // The trap this guards: collapsing to "Free" would tell a guest Saturday
    // costs nothing at a door charging 20.
    expect(doorPriceLabel(c(0, null, 20))).toBe('€0 · €20 weekends')
  })

  it('no price at all → null, never a guess', () => {
    expect(doorPriceLabel(c(null))).toBeNull()
    expect(doorPriceLabel({})).toBeNull()
  })

  it('a max equal to the min collapses to one number', () => {
    expect(doorPriceLabel(c(20, 20))).toBe('€20')
  })
})

describe('doorPriceOn', () => {
  const downtown = c(15, 20, 22, 25)

  it('quotes the weekday price midweek', () => {
    expect(doorPriceOn(downtown, 2)).toBe('€15–20')   // Tue
  })

  it('quotes the weekend price on Fri and Sat', () => {
    expect(doorPriceOn(downtown, 5)).toBe('€22–25')   // Fri
    expect(doorPriceOn(downtown, 6)).toBe('€22–25')   // Sat
  })

  it('Sunday is not the weekend for a door', () => {
    expect(doorPriceOn(downtown, 0)).toBe('€15–20')
  })

  it('falls back to the weekday price when no weekend price is set', () => {
    expect(doorPriceOn(c(20), 6)).toBe('€20')
  })

  it('unknown night → the all-week label’s weekday half', () => {
    expect(doorPriceOn(downtown, null)).toBe('€15–20')
  })
})
