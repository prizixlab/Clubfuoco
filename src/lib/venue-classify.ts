/**
 * Automatic venue classification from Google Places `types`.
 *
 * Decides whether a venue is nightlife (a bar or night club) and therefore
 * whether it should be shown to users. Used at import / backfill time so the
 * catalogue self-curates instead of needing manual cleanup.
 */

// Types that positively identify a nightlife venue.
const NIGHTLIFE_TYPES = new Set(['bar', 'night_club'])

// Placeholder types that carry no real category. A venue tagged with ONLY
// these is "unknown" — not confirmed non-nightlife — so it stays visible.
const GENERIC_TYPES = new Set(['establishment', 'point_of_interest', 'premise', 'food'])

export type VenueClass = 'nightlife' | 'non_nightlife' | 'unknown'

/**
 * Classifies a venue:
 *  - 'nightlife'      → Google tags it as a bar or night_club
 *  - 'non_nightlife'  → has a real, non-nightlife category (restaurant, cafe, …)
 *  - 'unknown'        → only generic types, or none — Google has no real data
 */
export function classifyVenue(types: readonly string[] | null | undefined): VenueClass {
  const t = types ?? []
  if (t.some(x => NIGHTLIFE_TYPES.has(x))) return 'nightlife'
  if (t.some(x => !GENERIC_TYPES.has(x)))  return 'non_nightlife'
  return 'unknown'
}

/**
 * Whether a venue should be visible to users. Unknowns are kept visible —
 * hiding a venue Google simply lacks data for would wrongly drop real clubs.
 */
export function venueShouldBeVisible(types: readonly string[] | null | undefined): boolean {
  return classifyVenue(types) !== 'non_nightlife'
}

/**
 * The `is_active` a backfill should write, given what it is NOW.
 *
 * A classifier fed only Google `types` can't tell a restaurant-by-day /
 * club-by-night (Negro Rojo is typed `restaurant`) from an actual restaurant,
 * so classification alone would deactivate real nightlife that a human already
 * curated as active. Rule: enrichment may PROMOTE a hidden venue it now
 * recognises as nightlife, but must never DEMOTE one that is already live —
 * that's a human decision, not Google's. A venue is only turned off by an
 * explicit operator action, never as a side effect of a data sync.
 */
export function activeAfterBackfill(
  currentlyActive: boolean,
  types: readonly string[] | null | undefined,
): boolean {
  if (currentlyActive) return true              // never demote a live venue
  return classifyVenue(types) === 'nightlife'   // only promote a confirmed one
}

/** Lowercase, strip accents, drop punctuation → words for loose comparison. */
function normWords(s: string): string[] {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // é→e, à→a, ü→u …
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')                       // L'Electricitat → l electricitat
    .split(/\s+/)
    .filter(w => w.length > 2)
}

// Words too generic to confirm a match on their own — "Bar Electricitat" vs
// "Bar Lobo" share "bar" but are different venues.
const STOPWORDS = new Set([
  'bar', 'cafe', 'club', 'restaurant', 'restaurante', 'the', 'barcelona', 'bcn',
])

/** Levenshtein edit distance, capped — we only care about "≤1". */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2   // can't be ≤1
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]; dp[0] = j
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i]
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1])
      prev = tmp
    }
  }
  return dp[a.length]
}

export type NameMatch = 'strong' | 'fuzzy' | 'none'

/**
 * How confidently a Places result names the venue we searched for.
 *
 * Accent- and punctuation-insensitive, ignoring generic words:
 *  - 'strong' — shares a distinctive word exactly, or one is a prefix (≥4) of
 *    the other. "L'Electricitat" ↔ "Bar Electricitat", "Xiloca" ↔ "Xiloka BCN".
 *    Safe to accept on the name alone.
 *  - 'fuzzy'  — a distinctive word within one edit. "Albaycin" ↔ "Albayzín"
 *    (c/z), "Bitacora" ↔ "Bitàcora". A real name is one typo away from a
 *    coincidence, so the caller should confirm with proximity before trusting.
 *  - 'none'   — nothing in common. "Bar Chivago" vs "Three Dots and a Dash".
 */
export function nameMatch(ourName: string, hitName: string): NameMatch {
  const ours = normWords(ourName).filter(w => !STOPWORDS.has(w))
  const theirs = normWords(hitName).filter(w => !STOPWORDS.has(w))
  if (ours.length === 0) return 'strong'      // nothing distinctive to gate on

  const strong = ours.some(w => theirs.some(t =>
    t === w ||
    (w.length >= 4 && t.startsWith(w)) ||
    (t.length >= 4 && w.startsWith(t))))
  if (strong) return 'strong'

  const fuzzy = ours.some(w => w.length >= 5 &&
    theirs.some(t => t.length >= 5 && editDistance(w, t) <= 1))
  return fuzzy ? 'fuzzy' : 'none'
}

/** Metres between two lat/lng points (haversine). */
export function distanceMeters(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
): number {
  const R = 6371000, rad = (d: number) => d * Math.PI / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * True for plain bars (a `bar` that is not also a `night_club`). Bars don't
 * charge a cover, so this is used to default `general_entry_price` to 0.
 */
export function isFreeEntryVenue(types: readonly string[] | null | undefined): boolean {
  const t = types ?? []
  return t.includes('bar') && !t.includes('night_club')
}
