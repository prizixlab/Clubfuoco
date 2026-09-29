package com.clubfuoco.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.Normalizer

/**
 * A ticketed event from `ra_events`. Ticket sales carry a markup, so a venue
 * with an event is monetisable and ranks above a plain venue in the feed (below
 * deal venues, which earn more).
 */
@Serializable
data class ExternalEvent(
    val id: String,
    val title: String? = null,
    @SerialName("venue_name") val venueName: String,
    /**
     * The table carries both `date` (naive local) and `event_date` (tz-aware);
     * the feed uses `date` so the day matches the planner's local yyyy-MM-dd,
     * exactly as the web does.
     */
    val date: String? = null,
) {
    /** "yyyy-MM-dd" for tier matching, or null when the row has no usable date. */
    val calendarDay: String?
        get() = date?.takeIf { it.length >= 10 }?.take(10)
}

/**
 * Fuzzy venue-name matching — port of src/lib/venue-match.ts and the Swift
 * `VenueMatch`. Event rows carry the promoter's free-text venue name ("La
 * Terrrazza"), which rarely equals the club row's name.
 *
 * Covered by `VenueMatchParityTest` against vectors generated from the shipping
 * Swift; change all implementations together.
 */
object VenueMatch {

    /**
     * Venue-type and address words — they say what a place IS or WHERE it is,
     * never which one it is. The address entries matter because the upstream
     * feed emits placeholder rows whose "name" is really a street address.
     */
    private val curatedGeneric = listOf(
        // venue type
        "barcelona", "club", "bar", "the", "lounge", "hotel", "cafe", "cafes",
        "music", "night", "live", "room", "space", "house", "disco", "dance",
        "party", "venue", "stage", "place", "sala", "local", "bcn", "spain",
        "restaurant", "restaurante", "cocktail", "cocteleria", "rooftop", "terrace",
        "terraza", "terrassa", "beach", "playa", "garden", "jardin", "sky",
        "teatre", "teatro", "theatre", "studio", "mansion", "social", "pool",
        // street / neighbourhood / landmark
        "carrer", "calle", "plaza", "placa", "avinguda", "avenida", "passeig",
        "paseo", "rambla", "ramblas", "llobregat", "montjuic", "vila", "prat",
        "catalunya", "pier", "port", "mar", "costa",
        // bare colour adjectives
        "azul",
    )

    /**
     * Words recurring across the live Barcelona club corpus often enough to
     * carry no identifying signal. Generated, not hand-picked: every word
     * appearing in 3+ distinct active club names.
     *
     * A minimum-length rule cannot substitute — the most distinctive venues are
     * the short ones ("moog", "apolo", "pacha", "shoko", "sutton").
     */
    private val corpusGeneric = listOf(
        "barceloneta", "beer", "bodega", "cafeteria", "cala", "casa", "cerveceria",
        "city", "entre", "frankfurt", "garage", "gaudi", "gracia", "gran", "granja",
        "hermanos", "irish", "jordi", "petit", "poblenou", "raco", "rincon", "rosa",
        "rose", "sant", "sants", "shisha", "tapas", "tavern", "taverna", "vermut",
    )

    private val stopwords: Set<String> = (curatedGeneric + corpusGeneric).toSet()

    /**
     * Fold diacritics, lowercase, then reduce anything that is not ASCII
     * alphanumeric to a single space. The ASCII check matters — without it a
     * letter the fold cannot decompose would survive here but be stripped by
     * the web's `[^a-z0-9]`, and the two would differ.
     */
    private fun normalized(s: String): String {
        val folded = Normalizer.normalize(s, Normalizer.Form.NFD)
            .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
            .lowercase()
        val mapped = folded.map { ch ->
            if (ch.code < 128 && (ch.isLetter() || ch.isDigit())) ch else ' '
        }.joinToString("")
        return mapped.split(" ").filter { it.isNotEmpty() }.joinToString(" ")
    }

    private fun meaningfulWords(s: String): List<String> =
        normalized(s).split(" ")
            .filter { it.length > 3 && it !in stopwords }

    /**
     * True when both names plausibly denote the same venue. Three ways to
     * match, strongest first:
     *   1. identical after normalisation;
     *   2. two or more shared meaningful words;
     *   3. exactly one shared meaningful word AND it is the only meaningful
     *      word on at least one side ("Razzmatazz" ~ "Razzmatazz sales 2 & 3").
     *
     * Rule 3 is the loosest, and an older matcher applied it to every word —
     * hence "Azul Rooftop Barceloneta" matching "Azimuth Rooftop Bar" on
     * "rooftop" alone.
     */
    fun matches(a: String, b: String): Boolean {
        val na = normalized(a)
        val nb = normalized(b)
        if (na.isEmpty() || nb.isEmpty()) return false
        if (na == nb) return true

        // Deduped: a name that repeats a word ("Bling Bling") still has a
        // single word's worth of identity, so the counts must not double it.
        val wa = meaningfulWords(a).toSet()
        val wb = meaningfulWords(b).toSet()
        if (wa.isEmpty() || wb.isEmpty()) return false

        val shared = wa intersect wb
        if (shared.size >= 2) return true
        if (shared.size == 1) return wa.size == 1 || wb.size == 1
        return false
    }
}
