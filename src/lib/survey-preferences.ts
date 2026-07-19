// Aggregates a user's post-night surveys (booking_surveys) into the
// preference profile the explore feed's surveyScore() consumes. Pure so it's
// unit-testable; /api/surveys/preferences is the only caller and the single
// source of truth — the iOS app consumes that route rather than re-deriving,
// so both platforms see identical signals by construction.

export interface SurveyRowInput {
  rating:        number
  drinks:        string[] | null                 // category ids: 'cocktails', 'beer', …
  drink_ratings: Record<string, number> | null   // per-drink stars: { 'Negroni': 4 }
  music_genres:  string[] | null
  vibe_rating:   number
  crowd_rating:  number
  would_return:  'yes' | 'maybe' | 'no' | null
  bookings: {
    booking_date: string
    clubs: {
      id:                  string
      name:                string
      general_entry_price: number | null
    } | null
  } | null
}

// clubs has no price_level column in production (drift) — proxy a 0–4 level
// from the entry price with the same thresholds budgetToPriceLevel uses on
// the explore page. Coarse, but deterministic and shared with iOS via the API.
export function entryPriceToLevel(euros: number): number {
  if (euros >= 999) return 4
  if (euros >= 80)  return 3
  if (euros >= 40)  return 2
  if (euros >= 20)  return 1
  return 0
}

export function deriveSurveyPreferences(surveys: SurveyRowInput[]) {
  if (!surveys.length) return null

  // ── Per-drink rating aggregation ─────────────────────────────────────────
  const drinkScores: Record<string, { total: number; count: number }> = {}
  for (const s of surveys) {
    for (const [drink, score] of Object.entries(s.drink_ratings ?? {})) {
      if (!drinkScores[drink]) drinkScores[drink] = { total: 0, count: 0 }
      drinkScores[drink].total += score
      drinkScores[drink].count += 1
    }
  }
  const avgDrinkRatings: Record<string, number> = {}
  for (const [drink, { total, count }] of Object.entries(drinkScores)) {
    avgDrinkRatings[drink] = Math.round((total / count) * 10) / 10
  }
  const favouriteDrinks = Object.entries(avgDrinkRatings)
    .filter(([, avg]) => avg >= 4)
    .sort((a, b) => b[1] - a[1])
    .map(([drink]) => drink)

  // ── Category-level drink counts (for broad signals) ───────────────────────
  const drinkCounts: Record<string, number> = {}
  for (const s of surveys) {
    for (const d of s.drinks ?? []) {
      drinkCounts[d] = (drinkCounts[d] ?? 0) + 1
    }
  }

  // ── Music genre aggregation ───────────────────────────────────────────────
  const genreCounts: Record<string, number> = {}
  for (const s of surveys) {
    for (const g of s.music_genres ?? []) {
      genreCounts[g] = (genreCounts[g] ?? 0) + 1
    }
  }
  const favouriteGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)

  // ── Averages ─────────────────────────────────────────────────────────────
  const avgRating = surveys.reduce((s, r) => s + r.rating,       0) / surveys.length
  const avgVibe   = surveys.reduce((s, r) => s + r.vibe_rating,  0) / surveys.length
  const avgCrowd  = surveys.reduce((s, r) => s + r.crowd_rating, 0) / surveys.length

  // ── Liked / disliked venue names ─────────────────────────────────────────
  const likedVenueNames: string[]    = []
  const dislikedVenueNames: string[] = []
  const avoidPlaceNames: string[]    = []
  for (const s of surveys) {
    const club = s.bookings?.clubs
    if (!club?.name) continue
    if (s.would_return === 'yes' && s.rating >= 4) likedVenueNames.push(club.name)
    if (s.would_return === 'no')                    dislikedVenueNames.push(club.name)
    if (s.would_return === 'no' || s.rating <= 2)   avoidPlaceNames.push(club.name)
  }

  // ── Preferred price level (mode over venues they'd return to) ────────────
  const priceCounts: Record<number, number> = {}
  for (const s of surveys) {
    const entry = s.bookings?.clubs?.general_entry_price
    if (entry != null && entry > 0 && s.would_return !== 'no') {
      const level = entryPriceToLevel(entry)
      priceCounts[level] = (priceCounts[level] ?? 0) + 1
    }
  }
  const preferredPriceLevel = Object.keys(priceCounts).length
    ? Number(Object.entries(priceCounts).sort((a, b) => b[1] - a[1])[0][0])
    : null

  // ── Drink-category signals ────────────────────────────────────────────────
  const likesCocktails = (drinkCounts['cocktails'] ?? 0) > 0
  const likesBeer      = (drinkCounts['beer']      ?? 0) > 0
  const likesWine      = (drinkCounts['wine']      ?? 0) > 0
  const likesShots     = (drinkCounts['shots']     ?? 0) > 0  // club/party signal
  const likesSoft      = (drinkCounts['soft']      ?? 0) > (surveys.length / 2)

  // ── Vibe signals — derived only from venues they ENJOYED ─────────────────
  // Low vibe rating = wrong genre at that venue, not a preference for calm.
  // We only draw positive conclusions: "they liked the energy at club-type venues."
  const nameOf = (s: SurveyRowInput) => (s.bookings?.clubs?.name ?? '').toLowerCase()
  const goodVibeAtClub = surveys.some(s =>
    ['club', 'disco', 'night', 'dance', 'rave', 'techno', 'house', 'sala']
      .some(kw => nameOf(s).includes(kw)) && s.vibe_rating >= 4)
  const goodVibeAtBar = surveys.some(s =>
    ['bar', 'pub', 'lounge', 'cafe', 'cocktail', 'jazz', 'wine', 'bistro']
      .some(kw => nameOf(s).includes(kw)) && s.vibe_rating >= 4)

  // Crowd signal — only positive: they've shown they like busy venues
  const likesBusyVenues = surveys.some(s => s.crowd_rating >= 4 && s.would_return !== 'no')

  return {
    surveyCount:        surveys.length,
    avgRating,
    avgVibeRating:      avgVibe,
    avgCrowdRating:     avgCrowd,
    preferredPriceLevel,
    // Per-drink signals (specific drinks with ratings)
    avgDrinkRatings,
    favouriteDrinks,
    // Category-level drink signals
    likesCocktails,
    likesBeer,
    likesWine,
    likesShots,
    likesSoft,
    drinkCounts,
    // Music genre signals
    favouriteGenres,
    genreCounts,
    // Vibe signals — positive only, never infer opposites
    goodVibeAtClub,
    goodVibeAtBar,
    likesBusyVenues,
    // Venue signals
    likedVenueNames:    [...new Set(likedVenueNames)],
    dislikedVenueNames: [...new Set(dislikedVenueNames)],
    avoidPlaceNames:    [...new Set(avoidPlaceNames)],
  }
}

export type SurveyPreferences = NonNullable<ReturnType<typeof deriveSurveyPreferences>>
