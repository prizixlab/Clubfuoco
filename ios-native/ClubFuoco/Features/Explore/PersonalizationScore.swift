import Foundation

/// Native port of the web feed's personalisation layer — surveyScore(),
/// tasteScore() and prefScore() in src/app/(app)/explore/page.tsx (~165–268).
/// THE WEIGHTS MUST MATCH THE WEB'S so both platforms rank the same user
/// comparably — change them together or the two feeds drift apart.

/// The user's onboarding preferences (users.preferences JSON). Only the fields
/// prefScore reads; Codable ignores the rest.
struct UserPreferences: Decodable, Sendable {
    var budget: Double?
    var vibes: [String]?
    var crowd: String?
}

/// The survey-derived preference profile from GET /api/surveys/preferences —
/// the same payload the web feed consumes, derived once server-side
/// (deriveSurveyPreferences in src/lib/survey-preferences.ts), so both
/// platforms score identical signals by construction. Only the fields the
/// scorer reads are modelled; Codable ignores the rest. All optional so a
/// payload shape change degrades a signal to neutral instead of nil-ing the
/// whole profile.
struct SurveyPreferences: Decodable, Sendable {
    var surveyCount: Int?
    var avgRating: Double?
    var avgVibeRating: Double?
    var avgCrowdRating: Double?
    var preferredPriceLevel: Int?
    var likesCocktails: Bool?
    var likesBeer: Bool?
    var likesWine: Bool?
    var likesShots: Bool?
    var goodVibeAtClub: Bool?
    var goodVibeAtBar: Bool?
    var likesBusyVenues: Bool?
    var likedVenueNames: [String]?
    var avoidPlaceNames: [String]?
}

/// Row from user_taste_profiles (computed from bookings + surveys + tags).
struct TasteProfile: Decodable, Sendable {
    var topNeighborhoods: [String]?
    var topGenres: [String]?
    var topVibes: [String]?
}

enum PersonalizationScore {
    /// Web's anyHas(): keyword against name, address/neighbourhood, stored
    /// music genres and tags. (Place.matches() skips the address — the web
    /// scoring doesn't, so this stays its own helper.)
    private static func anyHas(_ p: Place, _ kws: [String]) -> Bool {
        let name = p.name.lowercased()
        let addr = (p.address + " " + (p.neighborhood ?? "")).lowercased()
        if kws.contains(where: { name.contains($0) || addr.contains($0) }) { return true }
        let genresAndTags = (p.musicGenres + p.tags).map { $0.lowercased() }
        return kws.contains { kw in genresAndTags.contains { $0.contains(kw) } }
    }

    /// Web's normV(): lowercase, strip non-alphanumerics.
    private static func normV(_ s: String) -> String {
        String(s.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) })
    }

    static func budgetToPriceLevel(_ euros: Double) -> Int {
        if euros >= 999 { return 4 }
        if euros >= 80 { return 3 }
        if euros >= 40 { return 2 }
        if euros >= 20 { return 1 }
        return 0
    }

    /// Survey-based boost — same branches and weights as the web's surveyScore().
    static func surveyScore(_ p: Place, survey: SurveyPreferences?) -> Double {
        guard let survey else { return 0 }
        var score = 0.0
        let nameL = p.name.lowercased()
        let norm = normV(p.name)

        // Venues they loved → strong boost for similar (name-matched) venues
        for liked in survey.likedVenueNames ?? [] {
            if norm == normV(liked) || nameL.contains(liked.lowercased().prefix(6)) { score += 5 }
        }
        // Venues they hated → penalise
        for avoid in survey.avoidPlaceNames ?? [] {
            if norm == normV(avoid) || nameL.contains(avoid.lowercased().prefix(6)) { score -= 10 }
        }

        // Drink signal → venue type boost
        if survey.likesCocktails == true, anyHas(p, ["cocktail", "mixology", "speakeasy", "gin", "craft"]) { score += 3 }
        if survey.likesBeer == true, anyHas(p, ["pub", "cervecería", "brew", "beer", "craft"]) { score += 3 }
        if survey.likesWine == true, anyHas(p, ["wine", "bodega", "vinoteca", "vino"]) { score += 3 }
        if survey.likesShots == true, anyHas(p, ["club", "disco", "party", "night"]) { score += 2 }

        // Preferred price level
        if let preferred = survey.preferredPriceLevel, let level = p.priceLevel {
            score += Double(max(0, 3 - abs(level - preferred)))
        }

        // Vibe signals — positive only: they proved they enjoy this venue type's energy
        if survey.goodVibeAtClub == true, anyHas(p, ["club", "disco", "rave", "dance", "techno", "house", "sala"]) { score += 2 }
        if survey.goodVibeAtBar == true, anyHas(p, ["bar", "pub", "lounge", "cafe", "cocktail", "jazz", "wine"]) { score += 2 }
        if survey.likesBusyVenues == true, p.ratingsTotal > 200 || (p.rating ?? 0) >= 4.3 { score += 1 }

        return score
    }

    /// Taste-profile boost from stored tag-based signals — web's tasteScore().
    static func tasteScore(_ p: Place, taste: TasteProfile?) -> Double {
        guard let taste else { return 0 }
        var score = 0.0
        let nameL = p.name.lowercased()
        let addr = p.address.lowercased()

        // Neighbourhood match
        for n in taste.topNeighborhoods ?? [] {
            let nl = n.lowercased()
            if addr.contains(nl) || nameL.contains(nl) { score += 3 }
        }

        // Music genre tags → boost venues whose names hint at the genre
        let genreKw: [String: [String]] = [
            "techno":     ["techno", "input", "nitsa", "bunker", "sala"],
            "house":      ["house", "pacha", "bling"],
            "latin":      ["latin", "salsa", "reggaeton", "shoko", "latino"],
            "hip_hop":    ["sutton", "urban", "hip", "hop", "otto"],
            "indie":      ["indie", "apolo", "razzmatazz", "razz"],
            "electronic": ["electronic", "moog", "macarena", "mondo"],
            "jazz":       ["jazz", "blues", "acoustic", "live"],
        ]
        for genre in taste.topGenres ?? [] {
            let kws = genreKw[genre] ?? []
            if kws.contains(where: { nameL.contains($0) }) { score += 4 }
        }

        // Vibe tags
        let vibeKw: [String: [String]] = [
            "upscale":   ["club", "lounge", "vip", "sutton", "bling", "pacha"],
            "budget":    ["pub", "bar", "cervecería", "brew"],
            "rooftop":   ["rooftop", "terraza", "sky", "top"],
            "mid_range": ["cocktail", "bistro", "café"],
        ]
        for vibe in taste.topVibes ?? [] {
            let kws = vibeKw[vibe] ?? []
            if kws.contains(where: { nameL.contains($0) }) { score += 2 }
        }

        return score
    }

    /// The combined personalisation score — web's prefScore(): both signal
    /// layers plus onboarding budget/vibe/crowd preferences and rating bumps.
    static func prefScore(
        _ p: Place,
        prefs: UserPreferences?,
        survey: SurveyPreferences?,
        taste: TasteProfile?
    ) -> Double {
        var score = surveyScore(p, survey: survey) + tasteScore(p, taste: taste)
        guard let prefs else { return score }

        if let budget = prefs.budget, budget > 0, let level = p.priceLevel {
            let target = budgetToPriceLevel(budget)
            score += Double(max(0, 3 - abs(level - target)))
        }

        let nameL = p.name.lowercased()
        let vibeKw: [String: [String]] = [
            "beach":       ["beach", "mar", "maritim", "port"],
            "rooftop":     ["rooftop", "sky", "terraza", "top"],
            "upscale":     ["club", "lounge", "vip", "suite"],
            "underground": ["underground", "bunker", "basement", "techno"],
            "live_music":  ["music", "jazz", "live", "concert"],
            "wild":        ["club", "disco", "party"],
            "intimate":    ["bar", "bistro", "wine"],
        ]
        for v in prefs.vibes ?? [] {
            if vibeKw[v]?.contains(where: { nameL.contains($0) }) == true { score += 2 }
        }
        if prefs.crowd == "lgbtq" {
            if ["arena", "metro", "pride", "gay"].contains(where: { nameL.contains($0) }) { score += 3 }
        }
        if let rating = p.rating, rating >= 4.2 { score += 1 }
        if let rating = p.rating, rating >= 4.5 { score += 1 }
        return score
    }
}
