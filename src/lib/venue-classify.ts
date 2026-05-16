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
 * True for plain bars (a `bar` that is not also a `night_club`). Bars don't
 * charge a cover, so this is used to default `general_entry_price` to 0.
 */
export function isFreeEntryVenue(types: readonly string[] | null | undefined): boolean {
  const t = types ?? []
  return t.includes('bar') && !t.includes('night_club')
}
