package com.clubfuoco.app.models

import com.clubfuoco.app.features.rumbalist.PartnerBrand
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** `{ bookings, guest_signups, ticket_orders }`. */
data class BookingsResponse(
    val bookings: List<Booking> = emptyList(),
    val guestSignups: List<GuestSignup> = emptyList(),
    val ticketOrders: List<TicketOrder> = emptyList(),
)

@Serializable
data class Booking(
    val id: String,
    @SerialName("booking_type") val bookingType: String = "general",
    @SerialName("party_size") val partySize: Int = 1,
    @SerialName("booking_date") val bookingDate: String,
    @SerialName("arrival_window") val arrivalWindow: String? = null,
    val status: String = "confirmed",
    @SerialName("total_amount") val totalAmount: Double? = null,
    /**
     * Public CF-XXXXXXXX reference. A LABEL, not a secret: it appears on the
     * confirmation screen, in help and in support tooling. Display it freely —
     * but never encode it in a QR, see [doorToken].
     */
    @SerialName("qr_code_token") val qrCodeToken: String? = null,
    /** Strong 128-bit door secret (bookings.scan_token, DB-defaulted). */
    @SerialName("scan_token") val scanToken: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("attendance_status") val attendanceStatus: String? = null,
    @SerialName("attendance_confidence") val attendanceConfidence: Int? = null,
    @SerialName("checked_in_at") val checkedInAt: String? = null,
    /**
     * HH:MM cutoff for time-boxed invitations (rumba list and the like). When
     * set, the attendance window ends at cutoff + 3h rather than at club
     * closing. Always null for paid bookings today — this is for guest-list
     * entries.
     */
    @SerialName("cutoff_time") val cutoffTime: String? = null,
    val clubs: ClubSummary? = null,
    /**
     * The promoter/supplier whose guestlist this booking came from. null for
     * direct Club Fuoco bookings. Suppliers contractually require this credit
     * on the ticket, so it is surfaced on the card.
     */
    @SerialName("partner_brands") val partnerBrands: BookingBrand? = null,
) {
    val club: ClubSummary? get() = clubs
    val brand: PartnerBrand? get() = partnerBrands?.toModel()

    /**
     * The ONLY thing a QR may encode. The door resolver matches on `scan_token`
     * alone, so a QR carrying the CF- reference simply does not scan — there is
     * deliberately no fallback here. null means "we cannot render a working
     * pass", not "use the reference".
     */
    val doorToken: String? get() = scanToken
}

/** Minimal partner_brands row embedded on a booking. */
@Serializable
data class BookingBrand(
    val key: String? = null,
    val name: String,
    @SerialName("logo_url") val logoUrl: String? = null,
    val color: String? = null,
    @SerialName("attribution_label") val attributionLabel: String? = null,
) {
    fun toModel() = PartnerBrand(
        key = key.orEmpty(),
        name = name,
        logoUrl = logoUrl,
        color = color.orEmpty(),
        attributionRequired = true,
        attributionLabel = attributionLabel,
    )
}

@Serializable
data class ClubSummary(
    val id: String,
    val name: String,
    @SerialName("cover_image_url") val coverImageUrl: String? = null,
    val address: String? = null,
    val neighborhood: String? = null,
    /** Gates the "I'm here" button client-side before the server distance check. */
    val lat: Double? = null,
    val lng: Double? = null,
    /** Feeds the attendance window — check-in opens at the club's opening time. */
    @SerialName("opening_hours")
    @Serializable(with = FlexibleStringArraySerializer::class)
    val openingHours: List<String> = emptyList(),
)

@Serializable
data class GuestSignup(
    val id: String,
    @SerialName("full_name") val fullName: String? = null,
    @SerialName("party_size") val partySize: Int? = null,
    val status: String? = null,
    val tier: String? = null,
    @SerialName("checked_in") val checkedIn: Boolean? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("guest_lists") val guestLists: GuestListSummary? = null,
) {
    val guestList: GuestListSummary? get() = guestLists
}

@Serializable
data class GuestListSummary(
    val id: String,
    @SerialName("event_name") val eventName: String? = null,
    @SerialName("event_date") val eventDate: String? = null,
    @SerialName("cutoff_time") val cutoffTime: String? = null,
    @SerialName("free_entry_label") val freeEntryLabel: String? = null,
    val clubs: ClubSummary? = null,
)

@Serializable
data class TicketOrder(
    val id: String,
    @SerialName("event_name") val eventName: String? = null,
    @SerialName("venue_name") val venueName: String? = null,
    @SerialName("venue_place_id") val venuePlaceId: String? = null,
    @SerialName("event_date") val eventDate: String? = null,
    val quantity: Int? = null,
    @SerialName("base_price_cents") val basePriceCents: Int? = null,
    @SerialName("markup_cents") val markupCents: Int? = null,
    @SerialName("total_cents") val totalCents: Int? = null,
    val status: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)
