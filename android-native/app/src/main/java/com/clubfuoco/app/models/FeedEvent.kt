package com.clubfuoco.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Barcelona's calendar, not the device's.
 *
 * The venues are here, so the listing day is theirs. Letting a traveller's
 * timezone shift the date would move an event to the wrong night — which, for
 * someone deciding whether to go out tonight, is the whole answer wrong.
 */
private val MADRID: ZoneId = ZoneId.of("Europe/Madrid")

/**
 * One leg of a night that moves — "22:00 Bastión Beach Club, then 00:00 Opium".
 *
 * A route lives on the night itself (`promoter_nights.stops`) rather than as
 * separate events, so the guest reserves once and carries one pass.
 */
@Serializable
data class EventStop(
    /** Set when the stop is one of our venues, which is what lets the row open
     *  that club's page. Null for a free-text location. */
    @SerialName("clubId") val clubId: String? = null,
    val name: String,
    /** Bare clocks, "HH:MM". An end earlier than its start is the next morning. */
    val start: String? = null,
    val end: String? = null,
    val note: String? = null,
) {
    /**
     * Stable within one route. The same venue can appear twice — a night that
     * returns to the first room — so the name alone is not an identity.
     */
    val key: String get() = "$name|${start.orEmpty()}|${end.orEmpty()}"

    /** "22:00 – 00:00", or whichever half exists. */
    val timeLabel: String?
        get() = when {
            start != null && end != null -> "$start – $end"
            start != null -> start
            else -> end
        }
}

/**
 * One wave of tickets. Kept as strings on the wire where dates are concerned —
 * see [endsAtInstant].
 */
@Serializable
data class TicketRelease(
    val id: String,
    val position: Int = 0,
    val name: String? = null,
    @SerialName("priceCents") val priceCents: Int = 0,
    /** When it stops selling. Null = it runs until the doors open. */
    @SerialName("endsAt") val endsAt: String? = null,
    /** Tickets in this wave, in people. Null = no limit. */
    val quantity: Int? = null,
    /** Heads already taken. */
    val sold: Int = 0,
    /** live | upcoming | sold_out | ended */
    val state: String = "upcoming",
) {
    val isLive: Boolean get() = state == "live"

    /** Ended or sold out — a wave nobody can buy from any more. */
    val spent: Boolean get() = state == "ended" || state == "sold_out"

    /** PostgREST sends fractional seconds on some rows and not others. */
    val endsAtInstant: Instant?
        get() = endsAt?.let { runCatching { Instant.parse(it) }.getOrNull() }

    val priceText: String
        get() = if (priceCents % 100 == 0) "€${priceCents / 100}"
        else String.format(Locale.US, "€%.2f", priceCents / 100.0)

    /**
     * "12 left" — only when the wave is limited AND live, because a count on a
     * wave nobody can buy is noise, and on an unlimited one it is a lie.
     */
    fun remaining(): Int? {
        if (!isLive || quantity == null) return null
        val left = maxOf(0, quantity - sold)
        return if (left == 0) null else left
    }
}

/**
 * One of OUR events — a `promoter_nights` row, either a promoter's night or a
 * house night we run ourselves. Mirror of `FeedEvent` in
 * `src/app/api/events/feed/route.ts`.
 *
 * Not an [ExternalEvent] (the thin `ra_events` ticket cache) and not a
 * [ClubEvent] (the scraped listing on a venue page). Those describe other
 * people's events; this is the one we can actually put someone on the door list
 * for.
 *
 * Everything past [nightDate] is optional so a column drifting out of the
 * payload costs one line of a card rather than the whole decode — and with it
 * every event on the feed, not just the affected one.
 */
@Serializable
data class FeedEvent(
    val id: String,
    val title: String? = null,
    /** yyyy-MM-dd, the listing day. */
    @SerialName("nightDate") val nightDate: String = "",
    /** "23:00:00" — a bare clock, no date. */
    @SerialName("openTime") val openTime: String? = null,
    @SerialName("closeTime") val closeTime: String? = null,
    val description: String? = null,
    @SerialName("venueName") val venueName: String? = null,
    @SerialName("clubId") val clubId: String? = null,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val image: String? = null,
    @SerialName("photoUrls") val photoUrls: List<String>? = null,
    /**
     * Billed DJs in order. Reuses [LineupCredit] because our events store the
     * same shape the scraped feed does — `id` is an RA artist id, exactly what
     * `djs.ra_artist_id` holds — so a credit resolves to a real DJ rather than
     * matching by name.
     */
    val lineup: List<LineupCredit>? = null,
    /**
     * Who RUNS the night. Separate from [lineup]: a brand can host a night it
     * does not play, and a resident can play a night another collective hosts.
     */
    val hosts: List<LineupCredit>? = null,
    /** The route, when the night moves. Absent for an ordinary single venue. */
    val stops: List<EventStop>? = null,
    @SerialName("totalCapacity") val totalCapacity: Int? = null,
    /**
     * What one head costs RIGHT NOW. On a night that sells in waves this is the
     * LIVE release's price, computed server-side — never a stored column, which
     * goes stale the moment a wave sells out or its date passes.
     */
    @SerialName("priceCents") val priceCents: Int? = null,
    val releases: List<TicketRelease>? = null,
    /**
     * The invite token this night sells through. Null on a scraped listing and
     * on any night with no allocation behind it — in which case there is
     * nothing to buy and the dock must not offer one.
     */
    @SerialName("inviteToken") val inviteToken: String? = null,
    val currency: String? = null,
    /** Our editorial pin — what we chose to lead with. */
    @SerialName("isPinned") val isPinned: Boolean? = null,
    /**
     * The promoter's PAID promotion. Deliberately a separate signal from the
     * pin: a pin is a judgement, this is a purchase, and the feed ranks them in
     * that order. Never surfaced as a badge — the buyer gets rank, not a label
     * telling guests they paid.
     */
    val featured: Boolean? = null,
    /** Run by Club Fuoco rather than by a promoter. */
    @SerialName("isHouse") val isHouse: Boolean? = null,
) {
    // ── Tickets ──────────────────────────────────────────────────────────────

    val ladder: List<TicketRelease> get() = releases.orEmpty()

    /**
     * The wave on sale. Null on a flat-priced night, and also when every wave is
     * spent — which is what "sold out" looks like from here.
     */
    val liveRelease: TicketRelease? get() = ladder.firstOrNull { it.isLive }

    /** The next wave a guest would be pushed into, for "€15 from Friday". */
    val nextRelease: TicketRelease?
        get() {
            val live = liveRelease ?: return null
            return ladder.firstOrNull { it.position > live.position && it.state != "sold_out" }
        }

    val soldOut: Boolean get() = ladder.isNotEmpty() && liveRelease == null

    /** Ticketed, and we actually have a way to sell it. */
    val isTicketed: Boolean get() = (priceCents ?: 0) > 0 && inviteToken != null

    /**
     * Every event on this feed is free to attend today: house events are forced
     * free by a check constraint, and a promoter can only price a night once
     * Stripe has enabled charges on their account. Computed rather than assumed,
     * so the card asks the question.
     */
    val isFree: Boolean get() = (priceCents ?: 0) == 0

    val pinned: Boolean get() = isPinned == true
    val paid: Boolean get() = featured == true
    val house: Boolean get() = isHouse == true

    val displayTitle: String get() = title ?: venueName ?: "Event"

    // ── Route ────────────────────────────────────────────────────────────────

    /**
     * The stops, guaranteed to be a real route or nothing. The server already
     * collapses a one-stop list; this repeats the rule rather than trusting it,
     * because a single dot is not a schedule and the card would render one as
     * though the night moved.
     */
    val route: List<EventStop> get() = stops.orEmpty().takeIf { it.size >= 2 }.orEmpty()

    val isRoute: Boolean get() = route.isNotEmpty()

    /**
     * "Bastión Beach Club → Opium". Replaces the venue name wherever a card
     * would otherwise print it: [venueName] is only the FIRST stop on a route,
     * so showing it alone would claim the night happens in one place.
     */
    val routeLine: String? get() = if (isRoute) route.joinToString(" → ") { it.name } else null

    val placeLine: String? get() = routeLine ?: venueName

    // ── Dates ────────────────────────────────────────────────────────────────

    private val parsedDate: LocalDate?
        get() = runCatching { LocalDate.parse(nightDate) }.getOrNull()

    val isTonight: Boolean get() = parsedDate == LocalDate.now(MADRID)

    /**
     * "Tonight" / "Tomorrow" / "Sat 12 Sep". The two relative labels are what
     * people actually plan by; past that a date is clearer than a count.
     */
    fun dayLabel(tonight: String, tomorrow: String, locale: Locale = Locale.getDefault()): String {
        val day = parsedDate ?: return nightDate
        val today = LocalDate.now(MADRID)
        return when (day) {
            today -> tonight
            today.plusDays(1) -> tomorrow
            else -> day.format(DateTimeFormatter.ofPattern("EEE d MMM", locale))
        }
    }

    /**
     * "23:00 – 06:00", or just the opening time when there is no close. The
     * stored values are bare clocks (`time without time zone`), so they are
     * trimmed rather than parsed — there is no instant to convert.
     */
    val timeLabel: String?
        get() {
            fun clock(s: String?) = s?.takeIf { it.length >= 5 }?.take(5)
            val open = clock(openTime) ?: return clock(closeTime)
            val close = clock(closeTime) ?: return open
            return "$open – $close"
        }

    /** Night · time · venue, skipping whatever is missing. */
    fun metaLine(tonight: String, tomorrow: String): String =
        listOfNotNull(dayLabel(tonight, tomorrow), timeLabel, placeLine).joinToString(" · ")

    // ── Line-up ──────────────────────────────────────────────────────────────

    val credits: List<LineupCredit> get() = lineup.orEmpty()

    val hostCredits: List<LineupCredit> get() = hosts.orEmpty()

    /** "Club Fuoco × Nitsa" — co-hosts joined the way a flyer bills them. */
    val hostLine: String?
        get() = hostCredits.takeIf { it.isNotEmpty() }?.joinToString(" × ") { it.name }

    /**
     * "Marea, Dyad, Iker Roig +2" — the billing, in order, with the tail counted
     * rather than a name cut in half.
     */
    fun lineupLine(max: Int = 3): String? {
        val all = credits
        if (all.isEmpty()) return null
        val shown = all.take(max).joinToString(", ") { it.name }
        val extra = all.size - minOf(max, all.size)
        return if (extra > 0) "$shown +$extra" else shown
    }
}

/** Envelope of `GET /api/events/feed`. */
@Serializable
data class EventsPayload(val events: List<FeedEvent> = emptyList())
