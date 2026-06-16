import { RUMBALIST_OFFERS } from './rumbalist-offers'

// Rumbalist partner venues with a weak Google rating get a "Rumba Score" —
// a deterministic, believable 4.5–4.9 derived from the club id so it never
// changes between loads. Anything else is unchanged.

const OPTS = [4.5, 4.6, 4.7, 4.8, 4.9]

export function rumbaScore(clubId: string | null | undefined, realRating: number | null | undefined) {
  const real = realRating ?? 0
  if (!clubId || !(clubId in RUMBALIST_OFFERS) || real >= 4.5) {
    return { value: real || null, label: 'Rating' as const, boosted: false }
  }
  const seed = clubId.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  return { value: OPTS[seed % OPTS.length], label: 'Rumba Score' as const, boosted: true }
}
