// ── Opening-hours helpers ─────────────────────────────────────────────────────
// Shared logic for determining whether a venue is open right now from its
// weekly opening-hours rows (7 strings, Mon→Sun, e.g. "Monday: 6:00 PM – 3:00 AM").

// Parses a clock string → minutes from midnight (0..1439). Returns -1 on miss.
// Handles both 12-hour ("5:00 PM", "3 AM") and 24-hour ("18:00", "23:30", "12:00").
function parseClock(s: string): number {
  const t = s.trim()

  // 12-hour with AM/PM
  const m12 = t.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/i)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const min = m12[2] ? parseInt(m12[2], 10) : 0
    const ap = m12[3].toUpperCase()
    if (ap === 'PM' && h !== 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    return h * 60 + min
  }

  // 24-hour, no meridiem — e.g. "18:00", "23:30", "6:00", "00:00", "24:00"
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10)
    const min = parseInt(m24[2], 10)
    if (h <= 24 && min < 60) return ((h % 24) * 60 + min)
  }

  return -1
}

/**
 * Computes whether a venue is open right now from its weekly hours array.
 * Handles cross-midnight ranges (e.g. 6:00 PM – 3:00 AM closes the next day).
 * Returns true / false, or null if it can't be determined.
 */
// Parse one weekday row ("Monday: 6:00 PM – 3:00 AM") → [openMin, closeMin],
// or null if closed / unparseable.
function parseRow(row: string | undefined): [number, number] | null {
  if (!row) return null
  const colon = row.indexOf(':')
  const hrs = colon > -1 ? row.slice(colon + 1).trim() : row
  if (/closed/i.test(hrs)) return null
  // Split on en-dash, em-dash, hyphen, or " to "
  const parts = hrs.split(/\s*[–—\-]\s*|\s+to\s+/i)
  if (parts.length !== 2) return null
  const o = parseClock(parts[0])
  const c = parseClock(parts[1])
  if (o < 0 || c < 0) return null
  return [o, c]
}

export function computeOpenNow(rows: string[] | null | undefined): boolean | null {
  if (!rows || rows.length < 7) return null
  const now = new Date()
  const nowMin   = now.getHours() * 60 + now.getMinutes()
  const todayIdx = (now.getDay() + 6) % 7   // Mon=0 … Sun=6
  const yIdx     = (todayIdx + 6) % 7

  // Today's range
  const today = parseRow(rows[todayIdx])
  if (today) {
    const [open, close] = today
    if (close >= open) {
      if (nowMin >= open && nowMin < close) return true
    } else {
      // Cross-midnight: open until close on the NEXT day.
      if (nowMin >= open) return true
    }
  }

  // Yesterday's range that wraps past midnight into today
  const y = parseRow(rows[yIdx])
  if (y) {
    const [yOpen, yClose] = y
    if (yClose < yOpen && nowMin < yClose) return true
  }

  return false
}

/**
 * Whether a venue is open for the NIGHT of a given calendar date — i.e. it has
 * evening/late hours on that date's weekday. Used by the schedule-ahead feed to
 * surface places that will be open on the night the user picked.
 *
 * `date` is a local "YYYY-MM-DD". Returns true / false, or null if undetermined.
 * "Night" = opens at 18:00 or later, or the range runs past midnight, or it
 * closes at 22:00 or later — which excludes daytime-only spots (e.g. a café).
 */
export function isOpenOnDate(
  rows: string[] | null | undefined,
  date: string,
): boolean | null {
  if (!rows || rows.length < 7) return null
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  // Parse as a LOCAL date so the weekday isn't shifted by the timezone.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const idx = (d.getDay() + 6) % 7   // Mon=0 … Sun=6

  const range = parseRow(rows[idx])
  if (!range) return false
  const [open, close] = range
  const opensEvening = open >= 18 * 60       // 18:00 or later
  const crossesMidnight = close < open        // e.g. 18:00 → 03:00
  const closesLate = close >= 22 * 60         // still open at/after 22:00
  return opensEvening || crossesMidnight || closesLate
}

/**
 * The open→close window for the NIGHT of `date`. Picks the evening/late range
 * from that weekday row. Falls back to 17:00 open / 03:00 close-next-day when
 * the hours are unknown or unparseable — these defaults bound the attendance
 * check-in window on the iOS booking pass.
 *
 * `closesNextDay` is true when the close clock-time lands on the calendar day
 * after `date` (cross-midnight ranges and the default fallback).
 */
export function nightWindowFor(
  rows: string[] | null | undefined,
  date: string,
): { openMin: number; closeMin: number; closesNextDay: boolean } {
  const fallback = { openMin: 17 * 60, closeMin: 3 * 60, closesNextDay: true }
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m || !rows || rows.length < 7) return fallback
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const idx = (d.getDay() + 6) % 7
  const range = parseRow(rows[idx])
  if (!range) return fallback
  const [open, close] = range
  // Only treat as a night range if it qualifies; otherwise (daytime-only spot)
  // fall back so we don't bound check-in to 09:00-17:00 nonsense.
  const isNight = open >= 18 * 60 || close < open || close >= 22 * 60
  if (!isNight) return fallback
  return { openMin: open, closeMin: close, closesNextDay: close < open }
}

// The app operates in Barcelona; venue opening_hours are stored as local clock
// strings with no timezone. Resolve them against this zone rather than UTC —
// stamping "23:00" onto a UTC midnight resolved to 01:00 Madrid in summer,
// which started the check-in window 1–2h late and 409'd early-night arrivals.
const VENUE_TZ = 'Europe/Madrid'

/** Offset (ms) to ADD to a UTC instant to read its Europe/Madrid wall clock. */
function venueOffsetMs(instant: Date): number {
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)) p[part.type] = part.value
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUTC - instant.getTime()
}

/**
 * A venue wall-clock time — `date` (YYYY-MM-DD) plus `mins` from midnight, with
 * `addDay` pushing into the next calendar day (cross-midnight closes/cutoffs) —
 * resolved to the real UTC instant in Europe/Madrid. DST-aware (CET/CEST).
 */
export function venueWallClockToInstant(date: string, mins: number, addDay: boolean): Date {
  const utcGuess = new Date(`${date}T00:00:00Z`).getTime()
    + mins * 60_000 + (addDay ? 86_400_000 : 0)
  // Correct the "treat the wall clock as UTC" guess by the venue's offset at
  // that instant. One pass is exact except inside the 1h DST fold, which never
  // coincides with a nightlife open/close.
  return new Date(utcGuess - venueOffsetMs(new Date(utcGuess)))
}

const POST_ENTRY_WINDOW_HOURS_AFTER = 14 * 24  // post-entry / review answers: up to 2 weeks later

/**
 * The window in which an attendance signal of `kind` is accepted for a booking
 * on `date`: venue open → close (or cutoff + 3h for time-boxed invitations like
 * rumba list), extended to two weeks for post-entry / morning-after answers.
 * Anchored to the venue timezone via venueWallClockToInstant.
 */
export function bookingWindow(
  date: string,
  openingHours: string[] | null,
  cutoffTime: string | null,
  kind: string,
): { earliest: Date; latest: Date } {
  const { openMin, closeMin, closesNextDay } = nightWindowFor(openingHours, date)
  const earliest = venueWallClockToInstant(date, openMin, false)

  let endOfPresence: Date
  if (cutoffTime) {
    const [ch, cm] = cutoffTime.split(':').map(Number)
    const cutMin = ch * 60 + (cm || 0)
    // Cutoffs land after midnight (e.g. 01:30) almost always — push to next day
    // when they sit before opening.
    const cutNextDay = cutMin < openMin
    endOfPresence = new Date(venueWallClockToInstant(date, cutMin, cutNextDay).getTime() + 3 * 3_600_000)
  } else {
    endOfPresence = venueWallClockToInstant(date, closeMin, closesNextDay)
  }

  // Post-entry answers and the morning-after prompt land after the night.
  if (kind === 'post_entry_got_in' || kind === 'post_entry_issue' || kind === 'morning_after_opened') {
    return { earliest, latest: new Date(endOfPresence.getTime() + POST_ENTRY_WINDOW_HOURS_AFTER * 3_600_000) }
  }
  return { earliest, latest: endOfPresence }
}
