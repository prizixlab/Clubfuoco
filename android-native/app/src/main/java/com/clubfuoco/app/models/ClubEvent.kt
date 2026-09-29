package com.clubfuoco.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * One billed artist on an event. [id] is RA's artist id — the same key
 * `djs.ra_artist_id` uses — so a credit joins to a DJ page exactly. null on
 * rows scraped before the lineup field existed.
 */
@Serializable
data class LineupCredit(
    val id: String? = null,
    val name: String,
) {
    /**
     * Stable identity for a list key: two DJs can share neither id nor
     * position, but an id-less legacy credit still needs a key.
     */
    val key: String get() = id ?: "name:$name"
}

/**
 * An upcoming event at ONE venue, from `public.events`.
 *
 * Distinct from [ExternalEvent], which models the thinner `ra_events` cache the
 * explore feed reads. Events here are linked by `club_id` resolved at ingest, so
 * no fuzzy venue-name matching is involved.
 */
@Serializable
data class ClubEvent(
    @SerialName("ra_event_id") val raEventId: String,
    val title: String = "",
    /** yyyy-MM-dd, the listing day. */
    val date: String = "",
    /** ISO instant; already the correct Madrid time. */
    @SerialName("start_time") val startTime: String? = null,
    @SerialName("end_time") val endTime: String? = null,
    @SerialName("venue_name") val venueName: String? = null,
    val promoters: List<String>? = null,
    /** Names only, unordered — kept for rows predating `lineup`. */
    val artists: List<String>? = null,
    /** Ordered credits with RA artist ids. */
    val lineup: List<LineupCredit>? = null,
    val interested: Int? = null,
    val attending: Int? = null,
    @SerialName("ra_url") val raUrl: String? = null,
    val image: String? = null,
    val description: String? = null,
    @SerialName("minimum_age") val minimumAge: Int? = null,
    @SerialName("venue_capacity") val venueCapacity: String? = null,
    val cost: String? = null,
) {
    val id: String get() = raEventId

    /** Credits in billing order, falling back to bare names on legacy rows. */
    val credits: List<LineupCredit>
        get() = lineup ?: artists.orEmpty().map { LineupCredit(null, it) }

    val visibleCredits: List<LineupCredit> get() = credits.take(4)
    val extraCredits: Int get() = (credits.size - 4).coerceAtLeast(0)

    /**
     * A door price only when the source actually gave one.
     *
     * Most rows are "0", "€" or blank, and nothing distinguishes "free" from
     * "unknown" — so anything without a non-zero digit is treated as unknown and
     * the chip is simply not shown. Guessing here would misstate what someone
     * pays at the door.
     */
    val entryLabel: String?
        get() {
            val raw = cost?.trim().orEmpty()
            if (raw.isEmpty()) return null
            return if (raw.any { it.isDigit() && it != '0' }) raw else null
        }

    /** "23:00" — the start, in venue time. */
    val startLabel: String?
        get() = runCatching {
            Instant.parse(startTime)
                .atZone(ZoneId.of("Europe/Madrid"))
                .format(DateTimeFormatter.ofPattern("HH:mm"))
        }.getOrNull()

    /**
     * Capacity, only when the column holds a real number.
     *
     * `venue_capacity` is free text on the source and carries everything from
     * "" to "500-1000" to prose. Anything that is not a plain positive integer
     * is dropped rather than printed — a capacity chip reading "TBC" is worse
     * than no chip.
     */
    val capacityLabel: String?
        get() = venueCapacity?.trim()?.toIntOrNull()?.takeIf { it > 0 }
            ?.let { "%,d".format(Locale.getDefault(), it) }

    /**
     * "23:00 – 06:00", and whether the end lands on the NEXT day.
     *
     * The median night here runs six hours and most end between 02:00 and
     * 08:00, so the end time usually belongs to tomorrow. Rendering it bare
     * reads as wrong, which is why the caller gets the flag as well as the text.
     */
    val timeRange: Pair<String, Boolean>?
        get() {
            val zone = ZoneId.of("Europe/Madrid")
            val start = runCatching { Instant.parse(startTime).atZone(zone) }.getOrNull()
                ?: return null
            val pattern = DateTimeFormatter.ofPattern("HH:mm")
            val end = runCatching { Instant.parse(endTime).atZone(zone) }.getOrNull()
                ?: return start.format(pattern) to false
            val crosses = start.toLocalDate() != end.toLocalDate()
            return "${start.format(pattern)} – ${end.format(pattern)}" to crosses
        }

    /** Day / month / weekday for the date block on the card. */
    val dateParts: Triple<String, String, String>
        get() = runCatching {
            val day = java.time.LocalDate.parse(date)
            Triple(
                day.format(DateTimeFormatter.ofPattern("EEE", Locale.getDefault())).uppercase(),
                day.dayOfMonth.toString(),
                day.format(DateTimeFormatter.ofPattern("MMM", Locale.getDefault())).uppercase(),
            )
        }.getOrElse { Triple("", "", "") }
}

/**
 * A DJ surfaced on a club page in place of a real event — the "this slot is a
 * DJ set, not an event" case. Flattens a `club_dj_sets` row joined to its `djs`
 * catalogue row.
 */
data class FeaturedDJ(
    val raArtistId: String,
    val name: String,
    val genres: List<String> = emptyList(),
    val instagram: String? = null,
    val soundcloud: String? = null,
    val website: String? = null,
    val knownVenues: List<String> = emptyList(),
    val regions: List<String> = emptyList(),
    val bio: String? = null,
    val raUrl: String? = null,
    val imageUrl: String? = null,
    val coverImageUrl: String? = null,
    val raFollowers: Int? = null,
    // From the club_dj_sets slot (curated, optional):
    val residencyLabel: String? = null,
    val night: String? = null,
) {
    val id: String get() = raArtistId

    /**
     * A DJ not in our RA catalogue — surfaced from a single-DJ night by name
     * only (synthetic "guest:" id). Rendered as a "Special guest".
     */
    val isGuest: Boolean get() = raArtistId.startsWith("guest:")

    /** Origin from the most-played region, when present. */
    val origin: String? get() = regions.firstOrNull()?.takeIf { it.isNotEmpty() }

    /** "Resident · Saturdays" — only the parts we actually have. */
    val residencyLine: String?
        get() = listOfNotNull(residencyLabel?.trim(), night?.trim())
            .filter { it.isNotEmpty() }
            .takeIf { it.isNotEmpty() }
            ?.joinToString(" · ")
}

/** A `djs` catalogue row. */
@Serializable
data class DjCatalogueRow(
    @SerialName("ra_artist_id") val raArtistId: String,
    val name: String,
    val genres: List<String>? = null,
    val instagram: String? = null,
    val soundcloud: String? = null,
    val website: String? = null,
    @SerialName("known_venues") val knownVenues: List<String>? = null,
    val regions: List<String>? = null,
    val bio: String? = null,
    @SerialName("ra_url") val raUrl: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("cover_image_url") val coverImageUrl: String? = null,
    @SerialName("ra_followers") val raFollowers: Int? = null,
) {
    fun toFeaturedDj(residencyLabel: String? = null, night: String? = null) = FeaturedDJ(
        raArtistId = raArtistId,
        name = name,
        genres = genres.orEmpty(),
        instagram = instagram,
        soundcloud = soundcloud,
        website = website,
        knownVenues = knownVenues.orEmpty(),
        regions = regions.orEmpty(),
        bio = bio,
        raUrl = raUrl,
        imageUrl = imageUrl,
        coverImageUrl = coverImageUrl,
        raFollowers = raFollowers,
        residencyLabel = residencyLabel,
        night = night,
    )
}

/** The nested-join row: slot fields at top level, the DJ embedded. */
@Serializable
data class ClubDjSetRow(
    @SerialName("residency_label") val residencyLabel: String? = null,
    val night: String? = null,
    val dj: DjCatalogueRow? = null,
) {
    fun toFeaturedDj(): FeaturedDJ? = dj?.toFeaturedDj(residencyLabel, night)
}

/**
 * One dated appearance from `dj_appearances`.
 *
 * `club_id` is set only for venues we carry; rows in cities we have not
 * launched still come back (a DJ touring is signal, not a gap) and the UI
 * offers a "coming soon" note for that city rather than a dead link.
 */
@Serializable
data class DjGig(
    @SerialName("ra_event_id") val raEventId: String,
    val title: String? = null,
    val date: String = "",
    @SerialName("start_time") val startTime: String? = null,
    @SerialName("venue_name") val venueName: String? = null,
    val city: String? = null,
    val country: String? = null,
    @SerialName("club_id") val clubId: String? = null,
)
