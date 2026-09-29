package com.clubfuoco.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ── Friends (GET /api/friends, /api/friends/search) ──────────────────────────

/** Initials for the avatar placeholder — first letters of the first two words. */
private fun initialsOf(fullName: String?): String {
    val chars = fullName.orEmpty().split(" ")
        .filter { it.isNotEmpty() }
        .take(2)
        .mapNotNull { it.firstOrNull() }
    return if (chars.isEmpty()) "?" else chars.joinToString("").uppercase()
}

@Serializable
data class FriendUser(
    val id: String,
    @SerialName("fullName") val fullName: String? = null,
    @SerialName("avatarUrl") val avatarUrl: String? = null,
    @SerialName("friendshipId") val friendshipId: String? = null,
) {
    val initials: String get() = initialsOf(fullName)
}

@Serializable
data class FriendsData(
    val friends: List<FriendUser> = emptyList(),
    val incoming: List<FriendUser> = emptyList(),
    val outgoing: List<FriendUser> = emptyList(),
)

@Serializable
data class FriendSearchResult(
    val id: String,
    @SerialName("fullName") val fullName: String? = null,
    @SerialName("avatarUrl") val avatarUrl: String? = null,
    /** none | friends | outgoing | incoming */
    val relation: String = "none",
    @SerialName("friendshipId") val friendshipId: String? = null,
) {
    val initials: String get() = initialsOf(fullName)
}

// ── Notifications (GET /api/notifications) ───────────────────────────────────

@Serializable
data class AppNotification(
    val id: String,
    val type: String? = null,
    val title: String? = null,
    val body: String? = null,
    @SerialName("is_read") val isRead: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
)

// ── Fiamme (GET /api/fiamme) ─────────────────────────────────────────────────

/**
 * The loyalty balance. Field names follow the REST payload rather than the
 * database, because this one is served by the API route, not PostgREST.
 */
@Serializable
data class FiammeData(
    val balance: Int = 0,
    val tier: String? = null,
    @SerialName("nextTier") val nextTier: String? = null,
    @SerialName("toNextTier") val toNextTier: Int? = null,
    val activity: List<FiammeEntry> = emptyList(),
)

@Serializable
data class FiammeEntry(
    val id: String,
    val amount: Int = 0,
    val reason: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

// ── Groups (GET /api/groups, /api/groups/[id]) ───────────────────────────────

@Serializable
data class GroupClubInfo(
    val name: String? = null,
    @SerialName("coverImageUrl") val coverImageUrl: String? = null,
)

@Serializable
data class GroupListItem(
    val id: String,
    @SerialName("clubId") val clubId: String? = null,
    @SerialName("bookingType") val bookingType: String = "general",
    @SerialName("bookingDate") val bookingDate: String = "",
    val status: String = "open",
    @SerialName("inviteCode") val inviteCode: String? = null,
    val clubs: GroupClubInfo? = null,
    @SerialName("myRsvp") val myRsvp: String? = null,
) {
    val club: GroupClubInfo? get() = clubs
}

@Serializable
data class GroupMember(
    val id: String,
    @SerialName("userId") val userId: String? = null,
    @SerialName("fullName") val fullName: String? = null,
    @SerialName("avatarUrl") val avatarUrl: String? = null,
    /** organizer | member */
    val role: String = "member",
    /** invited | going | maybe | declined */
    val rsvp: String = "invited",
    @SerialName("paymentRequired") val paymentRequired: Boolean = false,
    @SerialName("amountDue") val amountDue: Double? = null,
    val charge: Double = 0.0,
    val paid: Boolean = false,
    @SerialName("isMe") val isMe: Boolean = false,
    @SerialName("bookingId") val bookingId: String? = null,
    /** Their pass QR — only ever set for me, never for other members. */
    @SerialName("qrToken") val qrToken: String? = null,
) {
    val initials: String get() = initialsOf(fullName)
}

@Serializable
data class GroupDetail(
    val id: String,
    @SerialName("clubId") val clubId: String? = null,
    @SerialName("clubName") val clubName: String = "",
    @SerialName("clubImage") val clubImage: String? = null,
    @SerialName("organizerId") val organizerId: String? = null,
    @SerialName("organizerName") val organizerName: String? = null,
    @SerialName("bookingType") val bookingType: String = "general",
    @SerialName("bookingDate") val bookingDate: String = "",
    @SerialName("inviteCode") val inviteCode: String = "",
    val status: String = "open",
    @SerialName("unitPrice") val unitPrice: Double = 0.0,
    val members: List<GroupMember> = emptyList(),
    val me: GroupMember? = null,
    /** Optional so the detail still decodes against an older deploy; nil = 0. */
    @SerialName("unreadCount") val unreadCount: Int? = null,
)

@Serializable
data class GroupMessage(
    val id: String,
    @SerialName("userId") val userId: String? = null,
    @SerialName("senderName") val senderName: String? = null,
    @SerialName("senderAvatarUrl") val senderAvatarUrl: String? = null,
    val body: String = "",
    @SerialName("createdAt") val createdAt: String = "",
    @SerialName("isMine") val isMine: Boolean = false,
) {
    val initials: String get() = initialsOf(senderName)

    /** First name for the small sender label above other people's bubbles. */
    val shortName: String
        get() = senderName.orEmpty().split(" ").firstOrNull().orEmpty().ifEmpty { "Someone" }
}
