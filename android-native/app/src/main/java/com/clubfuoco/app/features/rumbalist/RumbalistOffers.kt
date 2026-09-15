package com.clubfuoco.app.features.rumbalist

import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.util.ValidDays
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer

/**
 * The supplier behind an offer. Suppliers are offer providers, not the face of
 * the app — Club Fuoco stays the brand — but a contract clause can require a
 * small subordinate credit ("Guestlist by Rumba").
 */
@Serializable
data class PartnerBrand(
    val key: String,
    val name: String,
    @SerialName("logoUrl") val logoUrl: String? = null,
    val color: String = "",
    @SerialName("attributionRequired") val attributionRequired: Boolean? = null,
    @SerialName("attributionLabel") val attributionLabel: String? = null,
)

/** A bookable offer at a venue — free guestlist or a paid VIP table. */
data class RumbalistOffer(
    val kind: Kind,
    val title: String,
    val subtitle: String,
    val priceEur: Double? = null,
    val partySize: Int? = null,
    val timeWindow: String = "",
    val validDays: String = "",
    val dressCode: String = "",
    val music: String = "",
    /**
     * The supplier behind THIS offer. Offers come from many brands, so the
     * booking flow brands itself per offer rather than app-wide.
     */
    val brand: PartnerBrand? = null,
    /** Nights the supplier turned off, even though validDays covers them. */
    val skippedDates: List<String> = emptyList(),
    /** Paid front-screen promotion — pins this venue into the hero tier. */
    val featured: Boolean = false,
    val id: String = java.util.UUID.randomUUID().toString(),
) {
    enum class Kind { FREE_GUESTLIST, VIP_TABLE }

    val isVip: Boolean get() = kind == Kind.VIP_TABLE

    /** Only checks the skipped-dates exceptions — see [liveOn] for the full test. */
    fun runsOn(date: String): Boolean = date !in skippedDates

    /**
     * Live on [date] when the offer's valid days cover that weekday AND the
     * supplier has not skipped that specific night.
     *
     * CLIENT-SIDE ONLY: booking enforcement stays server-side in offerRunsOn().
     */
    fun liveOn(date: String): Boolean {
        val weekday = weekdayIndex(date) ?: return false
        return weekday in ValidDays.parse(validDays) && runsOn(date)
    }

    companion object {
        /**
         * Weekday (0=Sun…6=Sat) of a "yyyy-MM-dd" date via Sakamoto's
         * algorithm — pure integer arithmetic, so no timezone can shift the
         * day. Matches weekdayOf() in the web's valid-days.ts exactly.
         */
        fun weekdayIndex(date: String): Int? {
            val parts = date.split("-")
            if (parts.size != 3) return null
            var y = parts[0].toIntOrNull() ?: return null
            val m = parts[1].toIntOrNull() ?: return null
            val d = parts[2].toIntOrNull() ?: return null
            if (m !in 1..12 || d !in 1..31) return null
            val t = intArrayOf(0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4)
            if (m < 3) y -= 1
            return (y + y / 4 - y / 100 + y / 400 + t[m - 1] + d) % 7
        }
    }
}

/**
 * The live offer catalog, fetched from GET /api/partner. Keeps the catalog
 * editable (and the supplier swappable) without an app release.
 *
 * Unlike iOS there is no bundled fallback list: the iOS bundle exists to render
 * offers offline on first launch, and it caused a real bug there (a hidden
 * supplier's offers kept rendering after they vanished from the feed). Android
 * starts empty and shows nothing until the live fetch succeeds, which is the
 * behaviour the fix converged on anyway.
 */
object RumbalistOffers {

    /** clubs.id (lowercased) → offers. */
    @Volatile
    var byClub: Map<String, List<RumbalistOffer>> = emptyMap()
        private set

    /** The primary supplier, for surfaces that still want an app-wide brand. */
    @Volatile
    var brand: PartnerBrand? = null
        private set

    /**
     * Lowercased club ids with at least one LIVE offer, from the last
     * successful fetch — overwritten even when the answer is "none". null until
     * the first successful fetch. This is the membership signal for
     * deal-derived cosmetics like FuocoScore.
     */
    @Volatile
    var liveClubIds: Set<String>? = null
        private set

    fun hasLiveOffer(clubId: String): Boolean =
        liveClubIds?.contains(clubId.lowercase()) ?: false

    fun offers(clubId: String): List<RumbalistOffer> =
        byClub[clubId.lowercase()].orEmpty()

    @Serializable
    private data class Response(
        val brand: PartnerBrand? = null,
        val offersByClub: Map<String, List<OfferDto>> = emptyMap(),
    )

    @Serializable
    private data class OfferDto(
        val kind: String,
        val title: String = "",
        val subtitle: String = "",
        val priceEur: Double? = null,
        val partySize: Int? = null,
        val timeWindow: String = "",
        val validDays: String = "",
        val dressCode: String = "",
        val music: String = "",
        val brand: PartnerBrand? = null,
        val skippedDates: List<String>? = null,
        val featured: Boolean? = null,
    ) {
        fun toModel() = RumbalistOffer(
            kind = if (kind == "vip_table") RumbalistOffer.Kind.VIP_TABLE
            else RumbalistOffer.Kind.FREE_GUESTLIST,
            title = title,
            subtitle = subtitle,
            priceEur = priceEur,
            partySize = partySize,
            timeWindow = timeWindow,
            validDays = validDays,
            dressCode = dressCode,
            music = music,
            brand = brand,
            skippedDates = skippedDates.orEmpty(),
            featured = featured ?: false,
        )
    }

    /**
     * One fetch of the live offer set. Returns null on a FAILED request so
     * callers that rank venues can degrade to no-deal-signal; an empty map is a
     * real answer ("nothing is live") and IS authoritative.
     */
    suspend fun fetchLive(api: ApiClient): Map<String, List<RumbalistOffer>>? {
        val resp = runCatching {
            api.get("/api/partner", Response.serializer())
        }.getOrNull() ?: return null

        brand = resp.brand
        val mapped = resp.offersByClub.entries.associate { (k, v) ->
            k.lowercase() to v.map { it.toModel() }
        }
        byClub = mapped
        liveClubIds = mapped.keys
        return mapped
    }
}

/**
 * Deal-partner venues with a weak Google rating (below 4.5) get a "Fuoco
 * Score" — a deterministic, believable 4.5–4.9. Anything else is untouched.
 *
 * Membership comes from the LIVE offer catalog, never a frozen snapshot. The
 * value derives from the club's OWN id: an earlier version used the venue's
 * index in the sorted deal set, which moved every venue's displayed rating
 * whenever an unrelated venue was signed or dropped.
 */
object FuocoScore {
    private val options = doubleArrayOf(4.5, 4.6, 4.7, 4.8, 4.9)

    data class Result(
        /** null when there is nothing to show. */
        val value: Double?,
        /** true when this is a Fuoco Score, not the real rating. */
        val boosted: Boolean,
    )

    fun score(clubId: String?, realRating: Double?): Result {
        val real = realRating ?: 0.0
        if (clubId == null || !RumbalistOffers.hasLiveOffer(clubId) || real >= 4.5) {
            return Result(
                value = if (realRating != null && real > 0) real else null,
                boosted = false,
            )
        }
        return Result(options[(fnv1a(clubId.lowercase()) % 5u).toInt()], boosted = true)
    }

    /**
     * 64-bit FNV-1a — mixes every byte, so UUIDs differing in one hex digit
     * land on unrelated buckets (unlike summing char codes).
     */
    private fun fnv1a(s: String): ULong {
        var hash = 0xcbf29ce484222325UL
        for (byte in s.toByteArray()) {
            hash = hash xor byte.toUByte().toULong()
            hash *= 0x100000001b3UL
        }
        return hash
    }
}
