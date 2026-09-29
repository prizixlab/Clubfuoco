package com.clubfuoco.app.features.explore

import com.clubfuoco.app.models.Place
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.abs

/** The user's onboarding preferences (users.preferences JSON). */
@Serializable
data class UserPreferences(
    val budget: Double? = null,
    val vibes: List<String>? = null,
    val crowd: String? = null,
)

/**
 * The survey-derived preference profile from GET /api/surveys/preferences — the
 * same payload the web feed consumes, derived once server-side so both
 * platforms score identical signals by construction.
 *
 * All optional so a payload shape change degrades a signal to neutral instead
 * of nulling the whole profile.
 */
@Serializable
data class SurveyPreferences(
    @SerialName("surveyCount") val surveyCount: Int? = null,
    @SerialName("avgRating") val avgRating: Double? = null,
    @SerialName("avgVibeRating") val avgVibeRating: Double? = null,
    @SerialName("avgCrowdRating") val avgCrowdRating: Double? = null,
    @SerialName("preferredPriceLevel") val preferredPriceLevel: Int? = null,
    @SerialName("likesCocktails") val likesCocktails: Boolean? = null,
    @SerialName("likesBeer") val likesBeer: Boolean? = null,
    @SerialName("likesWine") val likesWine: Boolean? = null,
    @SerialName("likesShots") val likesShots: Boolean? = null,
    @SerialName("goodVibeAtClub") val goodVibeAtClub: Boolean? = null,
    @SerialName("goodVibeAtBar") val goodVibeAtBar: Boolean? = null,
    @SerialName("likesBusyVenues") val likesBusyVenues: Boolean? = null,
    @SerialName("likedVenueNames") val likedVenueNames: List<String>? = null,
    @SerialName("avoidPlaceNames") val avoidPlaceNames: List<String>? = null,
)

/** Row from user_taste_profile (computed from bookings + surveys + tags). */
@Serializable
data class TasteProfile(
    @SerialName("top_neighborhoods") val topNeighborhoods: List<String>? = null,
    @SerialName("top_genres") val topGenres: List<String>? = null,
    @SerialName("top_vibes") val topVibes: List<String>? = null,
)

/**
 * Port of the web feed's personalisation layer — surveyScore(), tasteScore()
 * and prefScore().
 *
 * THE WEIGHTS MUST MATCH THE WEB AND iOS so all platforms rank the same user
 * comparably. Change them together.
 */
object PersonalizationScore {

    /**
     * Web's anyHas(): keyword against name, address/neighbourhood, stored music
     * genres and tags. (`Place.matches` skips the address — the web scoring
     * does not, so this stays its own helper.)
     */
    private fun anyHas(p: Place, kws: List<String>): Boolean {
        val name = p.name.lowercase()
        val addr = (p.address + " " + (p.neighborhood ?: "")).lowercase()
        if (kws.any { name.contains(it) || addr.contains(it) }) return true
        val genresAndTags = (p.musicGenres + p.tags).map { it.lowercase() }
        return kws.any { kw -> genresAndTags.any { it.contains(kw) } }
    }

    /** Web's normV(): lowercase, strip non-alphanumerics. */
    private fun normV(s: String): String =
        s.lowercase().filter { it.isLetterOrDigit() }

    fun budgetToPriceLevel(euros: Double): Int = when {
        euros >= 999 -> 4
        euros >= 80 -> 3
        euros >= 40 -> 2
        euros >= 20 -> 1
        else -> 0
    }

    /** Survey-based boost — same branches and weights as the web's surveyScore(). */
    fun surveyScore(p: Place, survey: SurveyPreferences?): Double {
        if (survey == null) return 0.0
        var score = 0.0
        val nameL = p.name.lowercase()
        val norm = normV(p.name)

        // Venues they loved → strong boost for similar (name-matched) venues.
        for (liked in survey.likedVenueNames.orEmpty()) {
            if (norm == normV(liked) || nameL.contains(liked.lowercase().take(6))) score += 5
        }
        // Venues they hated → penalise.
        for (avoid in survey.avoidPlaceNames.orEmpty()) {
            if (norm == normV(avoid) || nameL.contains(avoid.lowercase().take(6))) score -= 10
        }

        // Drink signal → venue type boost.
        if (survey.likesCocktails == true &&
            anyHas(p, listOf("cocktail", "mixology", "speakeasy", "gin", "craft"))
        ) score += 3
        if (survey.likesBeer == true &&
            anyHas(p, listOf("pub", "cervecería", "brew", "beer", "craft"))
        ) score += 3
        if (survey.likesWine == true &&
            anyHas(p, listOf("wine", "bodega", "vinoteca", "vino"))
        ) score += 3
        if (survey.likesShots == true &&
            anyHas(p, listOf("club", "disco", "party", "night"))
        ) score += 2

        // Preferred price level.
        val preferred = survey.preferredPriceLevel
        val level = p.priceLevel
        if (preferred != null && level != null) {
            score += maxOf(0, 3 - abs(level - preferred)).toDouble()
        }

        // Vibe signals — positive only: they proved they enjoy this energy.
        if (survey.goodVibeAtClub == true &&
            anyHas(p, listOf("club", "disco", "rave", "dance", "techno", "house", "sala"))
        ) score += 2
        if (survey.goodVibeAtBar == true &&
            anyHas(p, listOf("bar", "pub", "lounge", "cafe", "cocktail", "jazz", "wine"))
        ) score += 2
        if (survey.likesBusyVenues == true &&
            (p.ratingsTotal > 200 || (p.rating ?: 0.0) >= 4.3)
        ) score += 1

        return score
    }

    /** Taste-profile boost from stored tag-based signals — web's tasteScore(). */
    fun tasteScore(p: Place, taste: TasteProfile?): Double {
        if (taste == null) return 0.0
        var score = 0.0
        val nameL = p.name.lowercase()
        val addr = p.address.lowercase()

        for (n in taste.topNeighborhoods.orEmpty()) {
            val nl = n.lowercase()
            if (addr.contains(nl) || nameL.contains(nl)) score += 3
        }

        val genreKw = mapOf(
            "techno" to listOf("techno", "input", "nitsa", "bunker", "sala"),
            "house" to listOf("house", "pacha", "bling"),
            "latin" to listOf("latin", "salsa", "reggaeton", "shoko", "latino"),
            "hip_hop" to listOf("sutton", "urban", "hip", "hop", "otto"),
            "indie" to listOf("indie", "apolo", "razzmatazz", "razz"),
            "electronic" to listOf("electronic", "moog", "macarena", "mondo"),
            "jazz" to listOf("jazz", "blues", "acoustic", "live"),
        )
        for (genre in taste.topGenres.orEmpty()) {
            if (genreKw[genre].orEmpty().any { nameL.contains(it) }) score += 4
        }

        val vibeKw = mapOf(
            "upscale" to listOf("club", "lounge", "vip", "sutton", "bling", "pacha"),
            "budget" to listOf("pub", "bar", "cervecería", "brew"),
            "rooftop" to listOf("rooftop", "terraza", "sky", "top"),
            "mid_range" to listOf("cocktail", "bistro", "café"),
        )
        for (vibe in taste.topVibes.orEmpty()) {
            if (vibeKw[vibe].orEmpty().any { nameL.contains(it) }) score += 2
        }

        return score
    }

    /**
     * The combined personalisation score — web's prefScore(): both signal
     * layers plus onboarding budget/vibe/crowd preferences and rating bumps.
     */
    fun prefScore(
        p: Place,
        prefs: UserPreferences?,
        survey: SurveyPreferences?,
        taste: TasteProfile?,
    ): Double {
        var score = surveyScore(p, survey) + tasteScore(p, taste)
        if (prefs == null) return score

        val budget = prefs.budget
        val level = p.priceLevel
        if (budget != null && budget > 0 && level != null) {
            val target = budgetToPriceLevel(budget)
            score += maxOf(0, 3 - abs(level - target)).toDouble()
        }

        val nameL = p.name.lowercase()
        val vibeKw = mapOf(
            "beach" to listOf("beach", "mar", "maritim", "port"),
            "rooftop" to listOf("rooftop", "sky", "terraza", "top"),
            "upscale" to listOf("club", "lounge", "vip", "suite"),
            "underground" to listOf("underground", "bunker", "basement", "techno"),
            "live_music" to listOf("music", "jazz", "live", "concert"),
            "wild" to listOf("club", "disco", "party"),
            "intimate" to listOf("bar", "bistro", "wine"),
        )
        for (v in prefs.vibes.orEmpty()) {
            if (vibeKw[v]?.any { nameL.contains(it) } == true) score += 2
        }
        if (prefs.crowd == "lgbtq" &&
            listOf("arena", "metro", "pride", "gay").any { nameL.contains(it) }
        ) score += 3

        val rating = p.rating
        if (rating != null && rating >= 4.2) score += 1
        if (rating != null && rating >= 4.5) score += 1
        return score
    }
}
