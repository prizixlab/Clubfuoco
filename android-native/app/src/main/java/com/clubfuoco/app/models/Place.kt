package com.clubfuoco.app.models

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * Feed venue model — mirror of the `Place` shape `getNearbyClubs()` produces in
 * src/lib/supabase/queries.ts (a mapped `clubs` row), and of `Place.swift`.
 */
@Serializable
data class Place(
    val placeId: String,
    val name: String,
    val slug: String? = null,
    val address: String = "",
    val neighborhood: String? = null,
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val rating: Double? = null,
    val ratingsTotal: Int = 0,
    val priceLevel: Int? = null,
    val isOpen: Boolean? = null,
    val weekdayHours: List<String> = emptyList(),
    val musicGenres: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val googlePlaceId: String? = null,
    val isFeatured: Boolean = false,
    val isPartner: Boolean = false,
    val generalEntryPrice: Double? = null,
    val vipTableMinSpend: Double? = null,
    val coverPhoto: String? = null,
    val photos: List<String> = emptyList(),
    var distance: Double? = null,
) {
    val id: String get() = placeId

    /** Keyword match against name + tags + genres (`anyHas()` on web). */
    fun matches(keywords: List<String>): Boolean {
        val haystack = (listOf(name) + tags + musicGenres).joinToString(" ").lowercase()
        return keywords.any { haystack.contains(it) }
    }

    companion object {
        val priceLabels = listOf("Free", "€", "€€", "€€€", "€€€€")
    }
}

/**
 * `opening_hours` is inconsistent in the database: sometimes a JSON array of
 * strings, sometimes a single string that itself contains JSON, sometimes a
 * plain string. Port of `FlexibleStringArray` / `toHoursArray()` — decoding
 * strictly would drop hours for a slice of venues.
 */
object FlexibleStringArraySerializer : KSerializer<List<String>> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleStringArray", PrimitiveKind.STRING)

    private val lenient = Json { ignoreUnknownKeys = true; isLenient = true }

    override fun deserialize(decoder: Decoder): List<String> {
        val input = decoder as? JsonDecoder ?: return emptyList()
        return when (val element = input.decodeJsonElement()) {
            is JsonArray -> element.mapNotNull { it.jsonPrimitive.contentOrNullSafe() }
            is JsonPrimitive -> {
                val raw = element.contentOrNullSafe().orEmpty()
                when {
                    raw.isEmpty() -> emptyList()
                    // A string that is itself a JSON array.
                    raw.trimStart().startsWith("[") ->
                        runCatching { lenient.decodeFromString<List<String>>(raw) }
                            .getOrElse { listOf(raw) }
                    else -> listOf(raw)
                }
            }
            else -> emptyList()
        }
    }

    override fun serialize(encoder: Encoder, value: List<String>) {
        encoder.encodeString(value.joinToString(","))
    }

    /** A JSON `null` arrives as an unquoted "null" literal, not as absence. */
    private fun JsonPrimitive.contentOrNullSafe(): String? =
        if (!isString && content == "null") null else content
}

/** Embedded `live_status` row from the PostgREST join. */
@Serializable
data class LiveStatus(
    @SerialName("is_open") val isOpen: Boolean? = null,
    @SerialName("crowd_percentage") val crowdPercentage: Int? = null,
    @SerialName("crowd_label") val crowdLabel: String? = null,
    @SerialName("current_dj") val currentDj: String? = null,
    @SerialName("queue_wait_minutes") val queueWaitMinutes: Int? = null,
)

@Serializable
data class ClubTag(val tag: String, val category: String? = null)

/** Raw `clubs` row from the nearby-clubs PostgREST select. */
@Serializable
data class NearbyClubRow(
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
     * Mirrors the `getNearbyClubs()` mapping: only self-hosted imagery counts
     * (Google Places URLs render broken), deduped, capped at 8.
     */
    fun toPlace(): Place {
        val allPhotos = (listOfNotNull(coverImageUrl) + photos.orEmpty() + galleryUrls.orEmpty())
            .filter {
                it.isNotEmpty() &&
                    !it.contains("maps.googleapis.com/maps/api/place/photo") &&
                    !it.contains("/api/places/photo")
            }
            .distinct()
            .take(8)

        return Place(
            placeId = id.lowercase(),
            name = name,
            slug = slug,
            address = address.orEmpty(),
            neighborhood = neighborhood,
            lat = lat ?: 0.0,
            lng = lng ?: 0.0,
            rating = rating,
            ratingsTotal = ratingsTotal ?: 0,
            priceLevel = null,
            isOpen = liveStatus?.isOpen,
            weekdayHours = openingHours,
            musicGenres = musicGenres.orEmpty(),
            tags = clubTags.orEmpty().map { it.tag },
            googlePlaceId = googlePlaceId,
            isFeatured = isFeatured ?: false,
            isPartner = isPartner ?: false,
            generalEntryPrice = generalEntryPrice,
            vipTableMinSpend = vipTableMinSpend,
            coverPhoto = allPhotos.firstOrNull(),
            photos = allPhotos,
        )
    }
}

/** Saved venue row (`place_favorites`). */
@Serializable
data class PlaceFavorite(@SerialName("place_id") val placeId: String)
