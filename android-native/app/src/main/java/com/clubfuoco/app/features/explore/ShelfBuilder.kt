package com.clubfuoco.app.features.explore

import com.clubfuoco.app.features.rumbalist.RumbalistOffer
import com.clubfuoco.app.models.ExternalEvent
import com.clubfuoco.app.models.Place
import com.clubfuoco.app.models.VenueMatch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** One horizontal row of the explore feed. */
@Serializable
data class Shelf(
    val id: String,
    val title: String,
    val subtitle: String,
    val places: List<Place>,
    val featured: Boolean = false,
)

/** Admin-managed custom shelf from GET /api/explore/shelves. */
@Serializable
data class CustomShelfRecord(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val mode: String,                               // 'auto' | 'manual'
    @SerialName("autoFilter") val autoFilter: String? = null,
    @SerialName("autoGenre") val autoGenre: String? = null,
    @SerialName("autoSort") val autoSort: String? = null,
    @SerialName("placeIds") val placeIds: List<String>? = null,
    val position: Int = 1,
)

/**
 * The explore shelf algorithm: featured deal hero + a rotating candidate pool +
 * admin custom shelves + the lead-staggering pass, with deal-first tiering and
 * personalisation scoring.
 *
 * Port of `ShelfBuilder.swift`, which mirrors the web's explore page. All three
 * must rank the same way — change them together.
 */
object ShelfBuilder {

    /**
     * Monetisable-first tiering (the dominant sort term), derived per build from
     * live data — a venue gaining or losing an offer or an event re-tiers on the
     * next build with no code or config change.
     *
     *   tier -1  paid front-screen (featured) offer running tonight
     *   tier  0  live offer running on the planned night
     *   tier  1  live offer, but not that night
     *   tier  2  ticketed event, or a Featured DJ
     *   tier  3  nothing to sell
     *
     * Deals outrank events and events outrank plain venues, ALWAYS — a lower
     * tier can never be beaten by personalisation score.
     */
    private data class DealRank(val tier: Int, val subRank: Int, val score: Double)

    fun build(
        places: List<Place>,
        custom: List<CustomShelfRecord> = emptyList(),
        offersByClub: Map<String, List<RumbalistOffer>> = emptyMap(),
        events: List<ExternalEvent> = emptyList(),
        djClubIds: Set<String> = emptySet(),
        planDate: String = "",
        prefs: UserPreferences? = null,
        survey: SurveyPreferences? = null,
        taste: TasteProfile? = null,
        t: (String) -> String,
    ): List<Shelf> {
        val shelves = mutableListOf<Shelf>()

        val dealRanks = HashMap<String, DealRank>(places.size)
        for (p in places) {
            val offers = offersByClub[p.placeId.lowercase()].orEmpty()
            val live = offers.filter { it.liveOn(planDate) }
            // Event days for this venue (fuzzy name match, like the web).
            val eventDays = events
                .filter { VenueMatch.matches(it.venueName, p.name) }
                .mapNotNull { it.calendarDay }
                .toSet()

            // A Featured DJ is real programming, so a DJ venue ranks like an
            // event venue rather than sinking to the plain-venue tier — that is
            // what surfaces DJ clubs instead of the same few popular names.
            val hasDj = djClubIds.contains(p.placeId)

            val tier: Int
            val subRank: Int
            when {
                live.isNotEmpty() -> {
                    tier = if (live.any { it.featured }) -1 else 0
                    subRank = if (live.any { it.isVip }) 0 else 1
                }
                offers.isNotEmpty() -> { tier = 1; subRank = 0 }
                eventDays.isNotEmpty() || hasDj -> {
                    tier = 2
                    subRank = if (eventDays.contains(planDate) || hasDj) 0 else 1
                }
                else -> { tier = 3; subRank = 0 }
            }

            dealRanks[p.placeId] = DealRank(
                tier = tier,
                subRank = subRank,
                score = PersonalizationScore.prefScore(p, prefs, survey, taste) +
                    (if (hasDj) 100.0 else 0.0),
            )
        }
        val fallback = DealRank(3, 0, 0.0)
        fun rank(p: Place): DealRank = dealRanks[p.placeId] ?: fallback

        /**
         * Stable re-sort: tier, then sub-rank, then score. Equal entries keep
         * the incoming order (rating, shuffle, …) — Kotlin's sortedWith is
         * documented stable, same as Swift's sorted(by:).
         */
        val tierOrder = Comparator<Place> { a, b ->
            val ra = rank(a)
            val rb = rank(b)
            when {
                ra.tier != rb.tier -> ra.tier.compareTo(rb.tier)
                ra.subRank != rb.subRank -> ra.subRank.compareTo(rb.subRank)
                else -> rb.score.compareTo(ra.score)
            }
        }
        fun ranked(arr: List<Place>): List<Place> = arr.sortedWith(tierOrder)

        // ── Featured hero — venues with a live offer on the planned night ────
        // Shuffled per build: feed order is most-rated-first, which made the
        // same venue the hero on every single load. Every partner gets a turn.
        val partners = places.filter { rank(it).tier <= 0 }.shuffled()
        if (partners.isNotEmpty()) {
            shelves.add(
                Shelf(
                    id = "hero",
                    title = t("shelf_hero_title"),
                    subtitle = t("shelf_hero_sub"),
                    places = partners.take(12),
                    featured = true,
                ),
            )
        }

        // ── Rotating pool — keyword/quality candidates, shuffled per load ────
        val pool = mutableListOf<Shelf>()
        fun candidate(id: String, pts: List<Place>, min: Int = 2) {
            if (pts.size >= min) {
                pool.add(
                    Shelf(
                        id = id,
                        title = t("shelf_${id}_title"),
                        subtitle = t("shelf_${id}_sub"),
                        places = ranked(pts).take(12),
                    ),
                )
            }
        }

        val byRating = compareByDescending<Place> { it.rating ?: 0.0 }
        val byPopular = compareByDescending<Place> { it.ratingsTotal }

        // Quality
        candidate("top_rated", places.filter { it.rating != null && it.ratingsTotal > 30 }.sortedWith(byRating))
        candidate("icons", places.filter { it.ratingsTotal > 300 }.sortedWith(byPopular), min = 3)
        candidate("gems", places.filter { (it.rating ?: 0.0) >= 4.0 && it.ratingsTotal < 300 }.sortedWith(byRating))
        candidate("value", places.filter { (it.generalEntryPrice ?: 0.0) == 0.0 && (it.rating ?: 0.0) >= 3.5 }.sortedWith(byRating))
        candidate("partner", places.filter { it.isPartner }.sortedWith(byRating), min = 1)
        candidate("featured", places.filter { it.isFeatured }.sortedWith(byRating), min = 1)
        candidate("most_popular", places.sortedWith(byPopular))
        candidate("local_fav", places.filter { (it.rating ?: 0.0) >= 4.0 }.shuffled())

        // Venue type
        candidate("clubs", places.filter { it.matches(listOf("club", "disco", "discoteca", "sala", "nightclub")) }.sortedWith(byRating))
        candidate("bars", places.filter { it.matches(listOf("bar", "lounge", "pub", "tavern")) }.sortedWith(byRating))
        candidate("cocktail", places.filter { it.matches(listOf("cocktail", "mixology", "speakeasy", "craft", "gin")) }.sortedWith(byRating))
        candidate("rooftop", places.filter { it.matches(listOf("rooftop", "roof", "sky", "terraza", "terrace", "terrat")) }.sortedWith(byRating))
        candidate("live_music", places.filter { it.matches(listOf("live", "music", "jazz", "concert", "acoustic", "sala")) }.sortedWith(byRating))

        // Music genres
        candidate("techno", places.filter { it.matches(listOf("techno", "industrial", "bunker", "raw", "underground", "hard")) }.sortedWith(byRating))
        candidate("house", places.filter { it.matches(listOf("house", "groove", "deep", "afro", "funky")) }.sortedWith(byRating))
        candidate("latin", places.filter { it.matches(listOf("latin", "salsa", "mambo", "cubano", "caribe", "tropical", "merengue")) }.sortedWith(byRating))

        // Neighbourhoods
        candidate("gothic", places.filter { it.matches(listOf("gothic", "gòtic", "barri", "gotic", "call", "ferran", "escudellers")) }.sortedWith(byRating))
        candidate("born", places.filter { it.matches(listOf("born", "borne", "sant pere", "princesa", "comerç", "montcada")) }.sortedWith(byRating))
        candidate("eixample", places.filter { it.matches(listOf("eixample", "gran via", "diagonal", "provença", "consell de cent", "muntaner", "enric granados")) }.sortedWith(byRating))
        candidate("gracia", places.filter { it.matches(listOf("gràcia", "gracia", "verdi", "travessera", "fontana", "lesseps", "torrent")) }.sortedWith(byRating))

        // Occasion
        candidate("date_night", places.filter { it.matches(listOf("cocktail", "wine", "lounge", "bistro", "speakeasy", "jazz", "rooftop")) && (it.rating ?: 0.0) >= 3.8 }.sortedWith(byRating))
        candidate("pre_drinks", places.filter { it.matches(listOf("bar", "pub", "lounge", "café")) }.sortedWith(byRating))
        candidate("first_timer", places.filter { it.ratingsTotal > 200 }.sortedWith(byPopular))

        shelves.addAll(pool.shuffled())

        val valid = shelves.filter { it.places.isNotEmpty() }

        // ── Stagger pass: each shelf leads with a venue not already leading ──
        val usedAsLead = mutableSetOf<String>()
        val staggered = mutableListOf<Shelf>()
        for (shelf in valid) {
            if (shelf.featured) {
                shelf.places.take(4).forEach { usedAsLead.add(it.placeId) }
                staggered.add(shelf)
                continue
            }
            // Deal-first WITHIN the fresh set and WITHIN the repeats set, but
            // every not-yet-used venue stays AHEAD of ones that already led a
            // shelf. This is what breaks "the same four clubs lead every row".
            // Because the pool order is shuffled per build, which shelf claims a
            // popular venue first varies each load, so pull-to-refresh
            // reshuffles the leads too — not just the hero.
            val fresh = shelf.places.filter { it.placeId !in usedAsLead }.sortedWith(tierOrder)
            val repeats = shelf.places.filter { it.placeId in usedAsLead }.sortedWith(tierOrder)
            val reordered = fresh + repeats
            reordered.take(3).forEach { usedAsLead.add(it.placeId) }
            staggered.add(shelf.copy(places = reordered))
        }

        // Admin shelves run through the same ranker as every other row.
        return mergeCustomShelves(staggered, custom, places) { ranked(it) }
    }

    /**
     * Default rows stay; custom shelves splice in at their `position`
     * (1 = right after the hero).
     */
    fun mergeCustomShelves(
        base: List<Shelf>,
        records: List<CustomShelfRecord>,
        places: List<Place>,
        rank: (List<Place>) -> List<Place> = { it },
    ): List<Shelf> {
        if (records.isEmpty()) return base
        val result = base.toMutableList()
        val index = places.associateBy { it.placeId }

        for (rec in records.sortedBy { it.position }) {
            var picks: List<Place>
            if (rec.mode == "manual") {
                picks = rec.placeIds.orEmpty().mapNotNull { index[it.lowercase()] }
            } else {
                var poolPlaces = places
                when (rec.autoFilter) {
                    "partner" -> poolPlaces = poolPlaces.filter { it.isPartner }
                    "featured" -> poolPlaces = poolPlaces.filter { it.isFeatured }
                    "open" -> poolPlaces = poolPlaces.filter { it.isOpen == true }
                    "genre" -> {
                        val g = rec.autoGenre.orEmpty().lowercase().trim()
                        if (g.isNotEmpty()) poolPlaces = poolPlaces.filter { it.matches(listOf(g)) }
                    }
                }
                poolPlaces = when (rec.autoSort) {
                    "rating" -> poolPlaces.sortedByDescending { it.rating ?: 0.0 }
                    "popular" -> poolPlaces.sortedByDescending { it.ratingsTotal }
                    else -> poolPlaces.shuffled()
                }
                picks = poolPlaces.take(12)
            }

            if (picks.size < (if (rec.mode == "manual") 1 else 2)) continue
            // Deal/event venues lead every row, custom shelves included. This
            // also reorders a MANUAL shelf's hand-picked list: the commercial
            // ordering outranks the admin's arrangement (the admin still
            // controls membership).
            picks = rank(picks)
            val shelf = Shelf(
                id = "custom_${rec.id}",
                title = rec.title,
                subtitle = rec.subtitle.orEmpty(),
                places = picks,
            )
            val at = rec.position.coerceIn(1, result.size.coerceAtLeast(1))
            result.add(minOf(at, result.size), shelf)
        }
        return result
    }

    // ── Filter chips ─────────────────────────────────────────────────────────

    val filterChips: List<Pair<String, String>> = listOf(
        "all" to "chip_all", "free" to "chip_free", "cocktails" to "chip_cocktails",
        "live" to "chip_live", "dancing" to "chip_dancing", "rooftop" to "chip_rooftop",
        "techno" to "chip_techno", "house" to "chip_house", "latin" to "chip_latin",
    )

    fun filter(places: List<Place>, chip: String): List<Place> = when (chip) {
        "free" -> places.filter { it.priceLevel == 0 || it.generalEntryPrice == 0.0 }
        "cocktails" -> places.filter { it.matches(listOf("cocktail")) }
        "live" -> places.filter { it.matches(listOf("live", "jazz", "music", "concert")) }
        "dancing" -> places.filter { it.matches(listOf("danc", "disco", "club")) }
        "rooftop" -> places.filter { it.matches(listOf("roof", "terraza", "terrace")) }
        "techno" -> places.filter { it.matches(listOf("techno")) }
        "house" -> places.filter { it.matches(listOf("house")) }
        "latin" -> places.filter { it.matches(listOf("latin", "salsa", "reggaeton")) }
        else -> places
    }
}
