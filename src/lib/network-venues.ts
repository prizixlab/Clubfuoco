// Single source of truth for the launch venue network as it appears in PUBLIC
// marketing copy (/, /about, /press, /investors). Import from here instead of
// hard-coding a count or a name list — the number appeared in five places and
// drifted.
//
// LANGUAGE RULE — read before writing copy that references this list:
// none of these venues has signed an agreement yet; deals are in active
// negotiation. Copy must say "featured", "launching with", or "built around".
// Never "partner venues" — that asserts a contractual relationship that does
// not currently exist.
//
// Names are the short marketing forms of rows in `clubs`. "CDLC" is Carpe Diem
// Lounge Club: one venue, listed once. It previously appeared as both "CDLC"
// and "Carpe Diem", which padded the public count to eleven off ten real rooms.
//
// Every name below is a distinct venue with an active row in `clubs` AND live
// rows in `partner_offers` — i.e. something a user can actually book tonight.
// That is the bar for appearing here. Verify against the DB before adding one.

export const NETWORK_VENUES = [
  'Opium',
  'Ku',
  'Jamboree',
  'CDLC',
  'Shôko',
  'Sutton',
  'Bling Bling',
  'Disco City Hall',
  'Downtown',
  'Twenties',
  'Colors Club',
] as const

export const NETWORK_VENUE_COUNT = NETWORK_VENUES.length

/** Spelled-out count, for prose ("eleven of the city's best venues"). */
export const NETWORK_VENUE_COUNT_WORD = 'eleven'

/** Sentence-initial form of the above. */
export const NETWORK_VENUE_COUNT_WORD_CAP =
  NETWORK_VENUE_COUNT_WORD[0].toUpperCase() + NETWORK_VENUE_COUNT_WORD.slice(1)
