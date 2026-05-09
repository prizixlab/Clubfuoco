import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

/**
 * GET /api/surveys/preferences
 *
 * Aggregates all of the user's survey responses into a preference profile
 * that the explore page uses for personalised recommendations.
 */
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data: surveys, error } = await supabase
    .from('booking_surveys')
    .select(`
      rating, drinks, vibe_rating, crowd_rating, would_return,
      bookings ( booking_date, clubs ( id, name, price_level ) )
    `)
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  if (error) return err(error.message)
  if (!surveys?.length) return ok(null)

  // ── Aggregate drink signals ──────────────────────────────────────────────
  const drinkCounts: Record<string, number> = {}
  for (const s of surveys) {
    for (const d of s.drinks ?? []) {
      drinkCounts[d] = (drinkCounts[d] ?? 0) + 1
    }
  }

  // ── Averages ─────────────────────────────────────────────────────────────
  const avgRating = surveys.reduce((s, r) => s + r.rating,      0) / surveys.length
  const avgVibe   = surveys.reduce((s, r) => s + r.vibe_rating,  0) / surveys.length
  const avgCrowd  = surveys.reduce((s, r) => s + r.crowd_rating, 0) / surveys.length

  // ── Liked / disliked venue names ─────────────────────────────────────────
  const likedVenueNames: string[]    = []
  const dislikedVenueNames: string[] = []
  const avoidPlaceNames: string[]    = []

  for (const s of surveys) {
    const club = (s.bookings as any)?.clubs
    if (!club?.name) continue
    if (s.would_return === 'yes' && s.rating >= 4) likedVenueNames.push(club.name)
    if (s.would_return === 'no')                    dislikedVenueNames.push(club.name)
    if (s.would_return === 'no' || s.rating <= 2)   avoidPlaceNames.push(club.name)
  }

  // ── Preferred price level (mode of liked venues) ─────────────────────────
  const priceCounts: Record<number, number> = {}
  for (const s of surveys) {
    const pl = (s.bookings as any)?.clubs?.price_level
    if (pl != null && s.would_return !== 'no') {
      priceCounts[pl] = (priceCounts[pl] ?? 0) + 1
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
  const goodVibeAtClub = surveys.some(s => {
    const name = ((s.bookings as any)?.clubs?.name ?? '').toLowerCase()
    const isClubType = ['club','disco','night','dance','rave','techno','house','sala']
      .some(kw => name.includes(kw))
    return isClubType && s.vibe_rating >= 4
  })
  const goodVibeAtBar = surveys.some(s => {
    const name = ((s.bookings as any)?.clubs?.name ?? '').toLowerCase()
    const isBarType = ['bar','pub','lounge','cafe','cocktail','jazz','wine','bistro']
      .some(kw => name.includes(kw))
    return isBarType && s.vibe_rating >= 4
  })

  // Crowd signal — only positive: they've shown they like busy venues
  const likesBusyVenues = surveys.some(s => s.crowd_rating >= 4 && s.would_return !== 'no')

  return ok({
    surveyCount:        surveys.length,
    avgRating,
    avgVibeRating:      avgVibe,
    avgCrowdRating:     avgCrowd,
    preferredPriceLevel,
    // Drink signals
    likesCocktails,
    likesBeer,
    likesWine,
    likesShots,
    likesSoft,
    drinkCounts,
    // Vibe signals — positive only, never infer opposites
    goodVibeAtClub,   // liked the music/energy at a club → boost similar clubs
    goodVibeAtBar,    // liked the atmosphere at a bar → boost similar bars
    likesBusyVenues,  // enjoyed a packed venue → boost popular spots
    // Venue signals
    likedVenueNames:    [...new Set(likedVenueNames)],
    dislikedVenueNames: [...new Set(dislikedVenueNames)],
    avoidPlaceNames:    [...new Set(avoidPlaceNames)],
  })
}
