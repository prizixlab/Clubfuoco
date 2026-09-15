package com.clubfuoco.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A promoter's guestlist allocation, as returned by
 * `GET /api/promoter-invites/<token>`.
 *
 * The REST layer already camelCases this payload, so the field names match
 * directly — the same reason the iOS models carry no explicit CodingKeys.
 */
@Serializable
data class InviteDetail(
    val id: String,
    /** Total heads the allocation is worth, across every guest on it. */
    val spots: Int = 0,
    /** Whether the promoter lets guests see each other's names. */
    @SerialName("groupVisible") val groupVisible: Boolean = false,
    val night: InviteNight,
)

@Serializable
data class InviteNight(
    val id: String,
    val title: String? = null,
    @SerialName("nightDate") val nightDate: String = "",
    @SerialName("openTime") val openTime: String? = null,
    @SerialName("closeTime") val closeTime: String? = null,
    @SerialName("locationName") val locationName: String? = null,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    @SerialName("autoCheckin") val autoCheckin: Boolean? = null,
    @SerialName("maxPlusOnes") val maxPlusOnes: Int? = null,
    /**
     * 0 = free, which is every night that existed before paid events. Nullable
     * so an older API response (or a night predating the column) decodes rather
     * than throwing.
     */
    @SerialName("priceCents") val priceCents: Int? = null,
    val currency: String? = null,
    val club: InviteClub? = null,
) {
    val isPaid: Boolean get() = (priceCents ?: 0) > 0

    /**
     * "€12" or "€12.50" — the trailing ".00" is dropped, because a door price is
     * almost always whole euros and "€12.00" reads like a form field.
     */
    fun priceLabel(heads: Int = 1): String {
        val total = (priceCents ?: 0) * maxOf(1, heads)
        val symbol = if ((currency ?: "eur").lowercase() == "eur") "€" else ""
        return if (total % 100 == 0) {
            "$symbol${total / 100}"
        } else {
            String.format(java.util.Locale.US, "%s%.2f", symbol, total / 100.0)
        }
    }

    /** Venue label — club name for partner clubs, the custom name otherwise. */
    val venueName: String get() = club?.name ?: locationName ?: "Location TBA"

    /** Geofence coordinate — club coords, else the custom pin. */
    val venueLat: Double? get() = club?.lat ?: lat
    val venueLng: Double? get() = club?.lng ?: lng
}

@Serializable
data class InviteClub(
    val id: String,
    val name: String,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
)

/** One claimed row on the allocation — a person plus their anonymous spots. */
@Serializable
data class InviteGuest(
    val id: String,
    @SerialName("fullName") val fullName: String = "",
    @SerialName("plusOnes") val plusOnes: Int = 0,
    /** null when the spot was claimed without an account. */
    @SerialName("claimedByUser") val claimedByUser: String? = null,
    @SerialName("checkedInAt") val checkedInAt: String? = null,
)

/** The whole GET response: the allocation plus everyone already on it. */
@Serializable
data class InviteLookup(
    val allocation: InviteDetail,
    val guests: List<InviteGuest> = emptyList(),
)

/**
 * One extra spot on the claim form: either OPEN (an anonymous plus-one that
 * whoever opens the shared link takes) or a specific FRIEND, who gets a targeted
 * invite and claims their own row.
 *
 * Both cost the claimer exactly one slot, which is what keeps the promoter's cap
 * honest no matter which way a spot gets filled.
 */
sealed class InviteSlot {
    abstract val key: String

    data class Open(override val key: String) : InviteSlot()

    data class Friend(val friend: FriendUser) : InviteSlot() {
        override val key: String get() = friend.id
    }
}
