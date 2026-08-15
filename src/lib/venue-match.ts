/**
 * Fuzzy venue-name matching between a promoter's free-text event venue name
 * (`ra_events.venue_name`, e.g. "La Terrrazza") and a `clubs.name` row.
 *
 * The single source of truth for the web. Ported verbatim to Swift in
 * ios-native/ClubFuoco/Models/ExternalEvent.swift (`VenueMatch`) — the two must
 * agree, so every test in venue-match.test.ts also appears as a Swift
 * self-check. Keep them in sync.
 *
 * Matching is deliberately PURE — a function of the two strings only, with no
 * dependency on the surrounding club corpus. The api/events route matches one
 * known club against live Remote Apollo results and has no corpus to consult,
 * so a runtime rarity/document-frequency rule could not be shared identically
 * across all three call sites. Rarity is instead baked in offline: see
 * CORPUS_GENERIC below.
 */

/** Strip diacritics so "Montjuïc" and "Montjuic" normalise alike. */
function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function normName(s: string) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Venue-type and address words. These describe what a place IS or WHERE it is,
 * never which one it is, so sharing one carries no evidence of identity.
 *
 * The address entries matter more than they look: Remote Apollo emits
 * placeholder rows like "TBA - Tech Barcelona Rooftop - Pier 01 - Plaça Pau
 * Vila 1", where the "name" is really a street address. Without these, such a
 * row matches every club sharing a street or neighbourhood word.
 */
const CURATED_GENERIC = [
  // venue type
  'barcelona', 'club', 'bar', 'the', 'lounge', 'hotel', 'cafe', 'cafes',
  'music', 'night', 'live', 'room', 'space', 'house', 'disco', 'dance',
  'party', 'venue', 'stage', 'place', 'sala', 'local', 'bcn', 'spain',
  'restaurant', 'restaurante', 'cocktail', 'cocteleria', 'rooftop', 'terrace',
  'terraza', 'terrassa', 'beach', 'playa', 'garden', 'jardin', 'sky',
  'teatre', 'teatro', 'theatre', 'studio', 'mansion', 'social', 'pool',
  // street / neighbourhood / landmark
  'carrer', 'calle', 'plaza', 'placa', 'avinguda', 'avenida', 'passeig',
  'paseo', 'rambla', 'ramblas', 'llobregat', 'montjuic', 'vila', 'prat',
  'catalunya', 'pier', 'port', 'mar', 'costa',
  // bare colour adjectives
  'azul',
]

/**
 * Words that recur across the live Barcelona club corpus often enough to carry
 * no identifying signal — generated, not hand-picked, so the list reflects the
 * data rather than my guesses about it.
 *
 * Regenerate with `node scripts/venue-stopwords.mjs`: it counts, over every
 * active club name, how many distinct clubs each word appears in (document
 * frequency) and emits those at df >= 3. That threshold is what separates
 * generic from distinctive here — "bodega" appears in 21 club names and
 * "cerveceria" in 9, while real venue names sit at df 1-2 ("razzmatazz" 2,
 * "apolo" 1, "macarena" 1).
 *
 * A length heuristic cannot do this job: 667 of 1000 club names reduce to a
 * single meaningful word, and Barcelona's most distinctive venues are short
 * ("moog" 4, "apolo" 5, "pacha" 5, "shoko" 5, "sutton" 6). Any minimum-length
 * gate strict enough to reject "casa" would also reject those.
 */
const CORPUS_GENERIC = [
  'barceloneta', 'beer', 'bodega', 'cafeteria', 'cala', 'casa', 'cerveceria',
  'city', 'entre', 'frankfurt', 'garage', 'gaudi', 'gracia', 'gran', 'granja',
  'hermanos', 'irish', 'jordi', 'petit', 'poblenou', 'raco', 'rincon', 'rosa',
  'rose', 'sant', 'sants', 'shisha', 'tapas', 'tavern', 'taverna', 'vermut',
]

export const VENUE_STOPWORDS = new Set([...CURATED_GENERIC, ...CORPUS_GENERIC])

/** Words long enough and distinctive enough to carry identity. */
export function meaningfulWords(s: string): string[] {
  return normName(s)
    .split(' ')
    .filter(w => w.length > 3 && !VENUE_STOPWORDS.has(w))
}

/**
 * True when both names plausibly denote the same venue.
 *
 * Three ways to match, in order of strength:
 *   1. identical after normalisation;
 *   2. two or more shared meaningful words — enough on its own, since two
 *      independent collisions are unlikely;
 *   3. exactly one shared meaningful word, AND it is the ONLY meaningful word
 *      on at least one side — i.e. that side's whole identity is the shared
 *      word. This is what admits "Razzmatazz" ~ "Razzmatazz sales 2 & 3" and
 *      "Input" ~ "Input High Fidelity Dance Club".
 *
 * Rule 3 is the loosest and is what the old matcher effectively applied to
 * EVERY word, which is where the false positives came from: "Azul Rooftop
 * Barceloneta" matched "Skygarden Barcelona Rooftop" and "Azimuth Rooftop Bar"
 * on the strength of "rooftop" alone.
 */
export function venueMatch(a: string, b: string): boolean {
  const na = normName(a)
  const nb = normName(b)
  if (!na || !nb) return false
  if (na === nb) return true

  // Deduped: a name that repeats a word ("Bling Bling") still has a single
  // word's worth of identity, so the counts below must not double-count it.
  const wordsA = new Set(meaningfulWords(a))
  const wordsB = new Set(meaningfulWords(b))
  if (wordsA.size === 0 || wordsB.size === 0) return false

  const shared = new Set([...wordsA].filter(w => wordsB.has(w)))

  if (shared.size >= 2) return true
  if (shared.size === 1) return wordsA.size === 1 || wordsB.size === 1
  return false
}
