import { describe, expect, it } from 'vitest'
import { deriveSurveyPreferences, entryPriceToLevel, type SurveyRowInput } from './survey-preferences'

// Rows shaped exactly like the live booking_surveys join (would_return is a
// 'yes' | 'maybe' | 'no' STRING — a boolean-truthiness check would read 'no'
// as positive, which is the bug the old client-side aggregate had).

const row = (over: Partial<SurveyRowInput> = {}): SurveyRowInput => ({
  rating: 5,
  drinks: ['cocktails'],
  drink_ratings: {},
  music_genres: [],
  vibe_rating: 5,
  crowd_rating: 5,
  would_return: 'yes',
  bookings: {
    booking_date: '2026-07-07',
    clubs: { id: 'd184f2f1', name: 'Ku (formerly Pacha)', general_entry_price: 20 },
  },
  ...over,
})

describe('deriveSurveyPreferences', () => {
  it('returns null with no surveys', () => {
    expect(deriveSurveyPreferences([])).toBeNull()
  })

  it('derives the profile from live-shaped rows', () => {
    const prefs = deriveSurveyPreferences([
      row(),
      row({
        bookings: {
          booking_date: '2026-07-10',
          clubs: { id: 'd649395c', name: 'CDLC Barcelona (Carpe Diem)', general_entry_price: null },
        },
      }),
    ])!
    expect(prefs.surveyCount).toBe(2)
    expect(prefs.likedVenueNames).toEqual(['Ku (formerly Pacha)', 'CDLC Barcelona (Carpe Diem)'])
    expect(prefs.avoidPlaceNames).toEqual([])
    expect(prefs.likesCocktails).toBe(true)
    expect(prefs.likesBeer).toBe(false)
    expect(prefs.likesBusyVenues).toBe(true)      // crowd 5 and would return
    expect(prefs.preferredPriceLevel).toBe(1)     // entry €20 → level 1; null entry skipped
    expect(prefs.avgRating).toBe(5)
  })

  it('only likes venues rated ≥4 that they would return to', () => {
    const prefs = deriveSurveyPreferences([
      row({ rating: 3 }),                              // liked venue but rating too low
      row({ would_return: 'maybe' }),                  // high rating but not a firm yes
    ])!
    expect(prefs.likedVenueNames).toEqual([])
  })

  it("treats would_return 'no' as avoid + disliked (string, not truthy)", () => {
    const prefs = deriveSurveyPreferences([
      row({ would_return: 'no', rating: 4 }),
    ])!
    expect(prefs.dislikedVenueNames).toEqual(['Ku (formerly Pacha)'])
    expect(prefs.avoidPlaceNames).toEqual(['Ku (formerly Pacha)'])
    expect(prefs.likedVenueNames).toEqual([])
    expect(prefs.likesBusyVenues).toBe(false)          // busy signal needs a non-'no' night
  })

  it('marks low-rated venues as avoid even when would_return is maybe', () => {
    const prefs = deriveSurveyPreferences([row({ rating: 2, would_return: 'maybe' })])!
    expect(prefs.avoidPlaceNames).toEqual(['Ku (formerly Pacha)'])
    expect(prefs.dislikedVenueNames).toEqual([])
  })

  it('derives vibe signals only from enjoyed nights at matching venue types', () => {
    const club = row({
      bookings: { booking_date: '2026-07-07', clubs: { id: 'x', name: 'Sutton Club', general_entry_price: null } },
    })
    const barLowVibe = row({
      vibe_rating: 2,
      bookings: { booking_date: '2026-07-08', clubs: { id: 'y', name: 'Paradiso Cocktail Bar', general_entry_price: null } },
    })
    const prefs = deriveSurveyPreferences([club, barLowVibe])!
    expect(prefs.goodVibeAtClub).toBe(true)
    expect(prefs.goodVibeAtBar).toBe(false)            // vibe 2 draws no conclusion
  })

  it('aggregates per-drink ratings and favourites', () => {
    const prefs = deriveSurveyPreferences([
      row({ drink_ratings: { Negroni: 5, 'Estrella Damm': 3 } }),
      row({ drink_ratings: { Negroni: 4 } }),
    ])!
    expect(prefs.avgDrinkRatings).toEqual({ Negroni: 4.5, 'Estrella Damm': 3 })
    expect(prefs.favouriteDrinks).toEqual(['Negroni'])
  })

  it('survives rows with no booking/club join', () => {
    const prefs = deriveSurveyPreferences([row({ bookings: null })])!
    expect(prefs.surveyCount).toBe(1)
    expect(prefs.likedVenueNames).toEqual([])
    expect(prefs.preferredPriceLevel).toBeNull()
  })

  it('deduplicates repeated venue names', () => {
    const prefs = deriveSurveyPreferences([row(), row()])!
    expect(prefs.likedVenueNames).toEqual(['Ku (formerly Pacha)'])
  })
})

describe('entryPriceToLevel', () => {
  it('maps entry euros onto the 0-4 scale the feed uses', () => {
    expect(entryPriceToLevel(10)).toBe(0)
    expect(entryPriceToLevel(20)).toBe(1)
    expect(entryPriceToLevel(40)).toBe(2)
    expect(entryPriceToLevel(80)).toBe(3)
    expect(entryPriceToLevel(999)).toBe(4)
  })
})
