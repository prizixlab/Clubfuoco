// Parses an offer's `valid_days` text into weekday indices (0=Sun…6=Sat).
//
// TypeScript port of the promoter app's parser
// (ios-promoters/FuocoPromoters/Core/Utils/ValidDays.swift) — the two must
// accept the same grammar, so change them together. The day picker writes a
// canonical form — "Every night" or an explicit comma list of 3-letter day
// abbreviations ("Mon, Tue, Sun") — and that path is matched exactly first.
// Legacy rows still carry free-form text, so the fallback accepts:
//   - "Every night" / "Any night" / "Daily" / "All week"  → all seven
//   - comma / slash / "&" / "and" separated lists, full or short day names
//   - ranges with "-", "–", "—" or "to": "Thu - Sun" (wraps past Saturday)
//   - "Weekends" (Fri & Sat, nightlife sense) / "Weekdays" (the complement)
// Unparseable text yields the empty set — the offer simply isn't shown as
// running that night, never a crash.

export const ALL_DAYS: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5, 6])

const ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const CANONICAL: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

// Match a free-form segment to a weekday. Substring match mirrors the old
// parser ("thursdays" → thu) but prefers a match at the start of the segment
// so noise words can't hijack it.
function dayIndex(segment: string): number | null {
  const s = segment.trim()
  if (!s) return null
  const prefix = ORDER.findIndex(d => s.startsWith(d))
  if (prefix !== -1) return prefix
  const contains = ORDER.findIndex(d => s.includes(d))
  return contains !== -1 ? contains : null
}

export function parseValidDays(raw: string): Set<number> {
  const v = raw.trim().toLowerCase()
  if (!v) return new Set()

  // Canonical fast path: every part is exactly a 3-letter abbreviation.
  if (v === 'every night') return new Set(ALL_DAYS)
  const exactParts = v.split(',').map(s => s.trim()).filter(s => s.length > 0)
  if (exactParts.length > 0 && exactParts.every(p => CANONICAL[p] !== undefined)) {
    return new Set(exactParts.map(p => CANONICAL[p]))
  }

  // Legacy free-form path.
  if (v.includes('every') || v.includes('any') || v.includes('daily')
      || v.includes('all week') || v.includes('7 nights')) return new Set(ALL_DAYS)
  if (v.includes('weekend')) return new Set([5, 6])          // Fri & Sat nights
  if (v.includes('weekday')) return new Set([0, 1, 2, 3, 4]) // their complement

  // Normalize list separators to commas, then handle ranges per part.
  let text = v
  for (const sep of [' and ', ' & ', '&', '/', '+', ';']) {
    text = text.split(sep).join(',')
  }

  const result = new Set<number>()
  for (const part of text.split(',')) {
    let seg = part.trim()
    if (!seg) continue
    // Range separators — em/en dash, hyphen, "to", "through".
    for (const word of [' through ', ' thru ', ' to ']) {
      seg = seg.split(word).join('-')
    }
    const ends = seg.split(/[–—-]/).map(s => s.trim()).filter(s => s.length > 0)
    if (ends.length === 2) {
      const a = dayIndex(ends[0])
      const b = dayIndex(ends[1])
      if (a !== null && b !== null) {
        let i = a
        for (;;) {
          result.add(i)
          if (i === b) break
          i = (i + 1) % 7
        }
        continue
      }
    }
    const d = dayIndex(seg)
    if (d !== null) result.add(d)
  }
  return result
}

// Weekday (0=Sun…6=Sat) of a "yyyy-MM-dd" calendar date, via Sakamoto's
// algorithm — pure integer arithmetic, so no timezone can shift the day the
// way Date parsing would. Returns null for malformed input.
export function weekdayOf(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  let y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  if (mo < 3) y -= 1
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[mo - 1] + d) % 7
}

export function validDaysInclude(raw: string, date: string): boolean {
  const w = weekdayOf(date)
  if (w === null) return false
  return parseValidDays(raw).has(w)
}

// The one shared liveness predicate (spec 1.3): an offer is live on `date`
// when it isn't archived, its valid_days cover that weekday, and the supplier
// hasn't skipped that specific night. Offers from /api/partner are already
// filtered to is_active server-side, so the flag is usually absent here —
// treat missing as active. CLIENT-SIDE ONLY: the booking routes enforce via
// offerRunsOn() in src/lib/partner.ts, never weaken that to match this.
export interface OfferLiveness {
  valid_days: string
  skipped_dates?: string[]
  is_active?: boolean
}

export function offerLiveOn(offer: OfferLiveness, date: string): boolean {
  if (offer.is_active === false) return false
  if (!validDaysInclude(offer.valid_days, date)) return false
  return !(offer.skipped_dates ?? []).includes(date)
}
