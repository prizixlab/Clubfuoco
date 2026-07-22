// Wallet pass timing: when a night's pass stops mattering.
//
// PassKit reads two date keys, and they do different jobs:
//   relevantDate    when the pass surfaces on the lock screen / at the top of
//                   the stack. Before and after, it sits quietly in Wallet.
//   expirationDate  once past, iOS greys the pass out and files it under
//                   "Expired Passes", out of the main list.
// Neither deletes anything — the user keeps the receipt, it just stops
// cluttering the wallet. Passes had neither key, so last month's guestlist
// still looked as current as tonight's.

const ZONE = 'Europe/Madrid'

/** The UTC offset Madrid is on at a given instant, as "+02:00" / "+01:00". */
function madridOffset(at: Date): string {
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find(p => p.type === 'timeZoneName')?.value ?? ''
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz)
  return m ? `${m[1]}${m[2]}:${m[3]}` : '+00:00'
}

/**
 * An ISO 8601 timestamp for a Madrid wall-clock time, so the value survives
 * DST without hardcoding an offset. `dayOffset` shifts the calendar day —
 * a night's pass expires the MORNING AFTER its date.
 *
 * `date` accepts "yyyy-MM-dd" or any ISO timestamp; only the calendar day is used.
 */
export function madridISO(date: string, hour: number, minute = 0, dayOffset = 0): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return null
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayOffset, hour, minute)
  const d = new Date(base)
  const pad = (n: number) => String(n).padStart(2, '0')
  const wall = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
  return `${wall}${madridOffset(d)}`
}

// A night out belongs to its calendar date but runs into the next morning.
// 08:00 the following day clears every Barcelona closing time (roughly
// 03:00–07:00) with room to spare, so a pass can't expire while its holder is
// still inside, in the queue, or re-entering.
const EXPIRY_HOUR = 8
// Doors are an evening thing; this is when the pass earns its place on the
// lock screen.
const RELEVANT_HOUR = 20

/** When a night's pass should stop showing as current. Null if the date is unusable. */
export function passExpiration(eventDate: string | null | undefined): string | null {
  return eventDate ? madridISO(eventDate, EXPIRY_HOUR, 0, 1) : null
}

/** When a night's pass should surface on the lock screen. */
export function passRelevantDate(eventDate: string | null | undefined): string | null {
  return eventDate ? madridISO(eventDate, RELEVANT_HOUR, 0, 0) : null
}

/**
 * Both keys for a night pass, ready to spread into pass.json. Empty when the
 * date is missing or malformed, so a bad value can never produce an
 * already-expired pass — it just behaves as before.
 */
export function nightPassDates(eventDate: string | null | undefined): {
  expirationDate?: string
  relevantDate?: string
} {
  const expirationDate = passExpiration(eventDate)
  const relevantDate = passRelevantDate(eventDate)
  return { ...(expirationDate ? { expirationDate } : {}), ...(relevantDate ? { relevantDate } : {}) }
}
