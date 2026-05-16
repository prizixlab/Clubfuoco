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
export function computeOpenNow(rows: string[] | null | undefined): boolean | null {
  if (!rows || rows.length < 7) return null
  const now = new Date()
  const nowMin   = now.getHours() * 60 + now.getMinutes()
  const todayIdx = (now.getDay() + 6) % 7   // Mon=0 … Sun=6
  const yIdx     = (todayIdx + 6) % 7

  const parseRow = (row: string | undefined): [number, number] | null => {
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
