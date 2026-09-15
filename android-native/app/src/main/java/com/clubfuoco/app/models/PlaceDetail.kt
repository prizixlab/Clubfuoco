package com.clubfuoco.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Venue detail — the richer shape `getClubById()` returns (description, socials,
 * full live status, all photos). Port of `PlaceDetail.swift`.
 */
data class PlaceDetail(
    val placeId: String,
    val name: String,
    val address: String,
    val neighborhood: String?,
    val description: String?,
    val instagramHandle: String?,
    val whatsappLink: String?,
    val rating: Double?,
    val ratingsTotal: Int,
    val live: LiveStatus?,
    val weekdayHours: List<String>,
    val musicGenres: List<String>,
    val tags: List<String>,
    val googlePlaceId: String?,
    val isPartner: Boolean,
    val isFeatured: Boolean,
    val generalEntryPrice: Double?,
    val vipTableMinSpend: Double?,
    val photos: List<String>,
) {
    val isOpen: Boolean? get() = live?.isOpen

    val instagramUrl: String?
        get() {
            val handle = instagramHandle?.takeIf { it.isNotEmpty() } ?: return null
            return "https://instagram.com/${handle.removePrefix("@")}"
        }
}

/** Raw `clubs` row from the detail select — a superset of [NearbyClubRow]. */
@Serializable
data class PlaceDetailRow(
    val id: String,
    val name: String,
    val slug: String? = null,
    val address: String? = null,
    val neighborhood: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    @SerialName("cover_image_url") val coverImageUrl: String? = null,
    @SerialName("gallery_urls") val galleryUrls: List<String>? = null,
    val photos: List<String>? = null,
    val rating: Double? = null,
    @SerialName("ratings_total") val ratingsTotal: Int? = null,
    @SerialName("music_genres") val musicGenres: List<String>? = null,
    @SerialName("google_place_id") val googlePlaceId: String? = null,
    val description: String? = null,
    @SerialName("instagram_handle") val instagramHandle: String? = null,
    @SerialName("whatsapp_link") val whatsappLink: String? = null,
    @SerialName("general_entry_price") val generalEntryPrice: Double? = null,
    @SerialName("vip_table_min_spend") val vipTableMinSpend: Double? = null,
    @SerialName("opening_hours")
    @Serializable(with = FlexibleStringArraySerializer::class)
    val openingHours: List<String> = emptyList(),
    @SerialName("is_featured") val isFeatured: Boolean? = null,
    @SerialName("is_partner") val isPartner: Boolean? = null,
    @SerialName("live_status") val liveStatus: LiveStatus? = null,
    @SerialName("club_tags") val clubTags: List<ClubTag>? = null,
) {
    /**
     * Unlike the feed mapping this does NOT cap the photo count — the detail
     * screen's strip shows everything the venue has.
     */
    fun toDetail(): PlaceDetail {
        val allPhotos = (listOfNotNull(coverImageUrl) + photos.orEmpty() + galleryUrls.orEmpty())
            .filter {
                it.isNotEmpty() &&
                    !it.contains("maps.googleapis.com/maps/api/place/photo") &&
                    !it.contains("/api/places/photo")
            }
            .distinct()

        return PlaceDetail(
            placeId = id.lowercase(),
            name = name,
            address = address.orEmpty(),
            neighborhood = neighborhood,
            description = description,
            instagramHandle = instagramHandle,
            whatsappLink = whatsappLink,
            rating = rating,
            ratingsTotal = ratingsTotal ?: 0,
            live = liveStatus,
            weekdayHours = openingHours,
            musicGenres = musicGenres.orEmpty(),
            tags = clubTags.orEmpty().map { it.tag },
            googlePlaceId = googlePlaceId,
            isPartner = isPartner ?: false,
            isFeatured = isFeatured ?: false,
            generalEntryPrice = generalEntryPrice,
            vipTableMinSpend = vipTableMinSpend,
            photos = allPhotos,
        )
    }
}
