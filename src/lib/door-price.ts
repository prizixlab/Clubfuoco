/**
 * What you pay at the door — with no guestlist and no table.
 *
 * One formatter, used by the app, the venue pages and the portal, because a
 * door price that reads differently in two places is the kind of thing a guest
 * screenshots and argues with a doorman about.
 *
 * The shape it renders (see 20260917_door_price.sql):
 *   min only              "€20"
 *   min + max             "€15–20"
 *   weekend pair as well  "€15–20 · €22–25 weekends"
 *   min 0, no weekend     "Free"
 *
 * Null/absent everywhere → null, and the caller shows whatever it showed before
 * there was a door price. Never invent one: "?" is honest, a guessed number is
 * not.
 */
export interface DoorPrice {
  door_price_min?: number | string | null
  door_price_max?: number | string | null
  door_price_weekend_min?: number | string | null
  door_price_weekend_max?: number | string | null
}

/** numeric(7,2) comes back from PostgREST as a string. */
const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "€20" or "€15–20". Trailing .00 is dropped; real cents are kept. */
const money = (n: number): string =>
  `€${Number.isInteger(n) ? n : n.toFixed(2)}`

function span(min: number, max: number | null): string {
  if (max === null || max === min) return money(min)
  // One currency mark across a range: "€15–20", not "€15–€20".
  const hi = Number.isInteger(max) ? String(max) : max.toFixed(2)
  return `${money(min)}–${hi}`
}

export function doorPriceLabel(c: DoorPrice): string | null {
  const min = num(c.door_price_min)
  if (min === null) return null

  const max = num(c.door_price_max)
  const wMin = num(c.door_price_weekend_min)
  const wMax = num(c.door_price_weekend_max)

  // Free all week. With a weekend price it is NOT simply "Free", so fall
  // through to the range form and let the weekend half say what it costs.
  if (min === 0 && max === null && wMin === null) return 'Free'

  const week = span(min, max)
  if (wMin === null) return week
  const weekend = wMin === 0 && wMax === null ? 'free' : span(wMin, wMax)
  return `${week} · ${weekend} weekends`
}

/**
 * The door price for one night, when the caller knows which night it is —
 * a venue card on a Saturday should not quote the Tuesday price.
 *
 * `weekday` is 0=Sun..6=Sat, matching valid-days.weekdayOf. Weekend is Fri+Sat.
 */
export function doorPriceOn(c: DoorPrice, weekday: number | null): string | null {
  const min = num(c.door_price_min)
  if (min === null) return null
  const isWeekend = weekday === 5 || weekday === 6
  const wMin = num(c.door_price_weekend_min)

  if (isWeekend && wMin !== null) {
    const wMax = num(c.door_price_weekend_max)
    return wMin === 0 && wMax === null ? 'Free' : span(wMin, wMax)
  }
  const max = num(c.door_price_max)
  return min === 0 && max === null ? 'Free' : span(min, max)
}
