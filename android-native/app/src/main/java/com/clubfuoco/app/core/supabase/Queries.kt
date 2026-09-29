package com.clubfuoco.app.core.supabase

import com.clubfuoco.app.features.explore.TasteProfile
import com.clubfuoco.app.features.explore.UserPreferences
import com.clubfuoco.app.models.Booking
import com.clubfuoco.app.models.ClubDjSetRow
import com.clubfuoco.app.models.ClubEvent
import com.clubfuoco.app.models.DjCatalogueRow
import com.clubfuoco.app.models.DjGig
import com.clubfuoco.app.models.FeaturedDJ
import com.clubfuoco.app.models.BookingsResponse
import com.clubfuoco.app.models.ExternalEvent
import com.clubfuoco.app.models.GuestSignup
import com.clubfuoco.app.models.TicketOrder
import com.clubfuoco.app.models.NearbyClubRow
import com.clubfuoco.app.models.Place
import com.clubfuoco.app.models.PlaceDetail
import com.clubfuoco.app.models.PlaceDetailRow
import com.clubfuoco.app.models.PlaceFavorite
import com.clubfuoco.app.models.UserProfile
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The surfaces the app reads straight from PostgREST under RLS instead of via
 * the REST API. Port of `Queries.swift`, itself a mirror of
 * src/lib/supabase/queries.ts.
 *
 * This is not an optimisation — it is a correctness requirement. Several
 * user-scoped API routes read with the COOKIE client, which is anonymous for a
 * native Bearer request, so RLS returns nothing. The direct query runs as the
 * real signed-in user and `auth.uid() = user_id` passes.
 */
class Queries(private val supabase: SupabaseService) {

    /**
     * The signed-in user's `users` row.
     *
     * `/api/auth/me` is cookie-only and 401s for Bearer requests, so the native
     * clients use this direct query instead — the same choice iOS made.
     */
    suspend fun me(): UserProfile? {
        val uid = supabase.currentUserId() ?: return null
        return runCatching {
            supabase.client.postgrest.from("users")
                .select { filter { eq("id", uid) } }
                .decodeSingleOrNull<UserProfile>()
        }.getOrNull()
    }

    /**
     * Update the signed-in user's `users` row (RLS-scoped) — used by
     * complete-profile, the signup birthday step, and OAuth name capture.
     */
    suspend fun updateMe(updates: JsonObject) {
        val uid = supabase.currentUserId() ?: return
        supabase.client.postgrest.from("users")
            .update(updates) { filter { eq("id", uid) } }
    }

    /** Convenience for the single-field updates the auth flow makes. */
    suspend fun updateMe(vararg pairs: Pair<String, String?>) {
        updateMe(
            buildJsonObject {
                pairs.forEach { (key, value) ->
                    if (value == null) put(key, JsonPrimitive(null as String?)) else put(key, value)
                }
            },
        )
    }

    // ── Explore feed (mirrors getNearbyClubs) ────────────────────────────────

    /**
     * Clubs within [radius] metres of (lat, lng) — same bounding box, ordering
     * and photo gating as the web feed.
     *
     * Feed cards only render the cover photo, so this skips the heavy
     * `gallery_urls` array; the detail screen re-fetches it via [clubById].
     */
    suspend fun nearbyClubs(lat: Double, lng: Double, radius: Double): List<Place> {
        val latDelta = radius / 111_000
        val lngDelta = radius / 85_000

        val rows = supabase.client.postgrest.from("clubs").select(
            Columns.raw(
                """
                id, name, slug, address, neighborhood,
                lat, lng, cover_image_url, photos,
                rating, ratings_total, music_genres, google_place_id,
                general_entry_price, vip_table_min_spend, opening_hours,
                is_featured, is_partner,
                live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ),
                club_tags ( tag, category )
                """.trimIndent().replace("\n", " "),
            ),
        ) {
            filter {
                eq("is_active", true)
                gte("lat", lat - latDelta)
                lte("lat", lat + latDelta)
                gte("lng", lng - lngDelta)
                lte("lng", lng + lngDelta)
            }
            order("is_featured", Order.DESCENDING)
            order("is_partner", Order.DESCENDING)
            order("ratings_total", Order.DESCENDING, nullsFirst = false)
            order("rating", Order.DESCENDING, nullsFirst = false)
            limit(500)
        }.decodeList<NearbyClubRow>()

        // Photoless venues are held back until they have real imagery.
        return rows.map { it.toPlace() }.filter { it.photos.isNotEmpty() }
    }

    /**
     * Full club rows for a set of ids — used by the Saved (hearted) clubs page.
     * Unlike the feed, photoless venues are KEPT: the user explicitly saved them.
     */
    suspend fun clubsByIds(ids: List<String>): List<Place> {
        if (ids.isEmpty()) return emptyList()
        val rows = supabase.client.postgrest.from("clubs").select(
            Columns.raw(
                """
                id, name, slug, address, neighborhood,
                lat, lng, cover_image_url, gallery_urls, photos,
                rating, ratings_total, music_genres, google_place_id,
                general_entry_price, vip_table_min_spend, opening_hours,
                is_featured, is_partner,
                live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ),
                club_tags ( tag, category )
                """.trimIndent().replace("\n", " "),
            ),
        ) {
            filter { isIn("id", ids) }
            order("rating", Order.DESCENDING, nullsFirst = false)
        }.decodeList<NearbyClubRow>()
        return rows.map { it.toPlace() }
    }

    /** Full club row for the detail screen (mirrors getClubById). */
    suspend fun clubById(id: String): PlaceDetail? = runCatching {
        supabase.client.postgrest.from("clubs").select(
            Columns.raw(
                """
                id, name, slug, address, neighborhood,
                lat, lng, cover_image_url, gallery_urls, photos,
                rating, ratings_total, music_genres, google_place_id,
                description, instagram_handle, whatsapp_link,
                general_entry_price, vip_table_min_spend,
                opening_hours, is_featured, is_partner, is_active,
                live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ),
                club_tags ( tag, category )
                """.trimIndent().replace("\n", " "),
            ),
        ) {
            filter { eq("id", id) }
            limit(1)
        }.decodeList<PlaceDetailRow>().firstOrNull()?.toDetail()
    }.getOrNull()

    /**
     * Upcoming events at ONE venue. Joined on `club_id` — resolved at ingest —
     * not on venue name, so one rooftop's event cannot appear on another's
     * page. Past events stay in the table as history and are filtered here.
     */
    suspend fun clubEvents(clubId: String): List<ClubEvent> = runCatching {
        val today = java.time.LocalDate.now(java.time.ZoneId.of("Europe/Madrid")).toString()
        supabase.client.postgrest.from("events")
            .select(
                Columns.raw(
                    "ra_event_id, title, date, start_time, end_time, venue_name, promoters, " +
                        "artists, lineup, interested, attending, ra_url, image, description, " +
                        "minimum_age, venue_capacity, cost",
                ),
            ) {
                filter {
                    eq("club_id", clubId)
                    // Nights that are really just a lone DJ playing are hidden
                    // here and surfaced as a Featured DJ box instead.
                    eq("is_dj_set", false)
                    gte("date", today)
                }
                order("date", Order.ASCENDING)
                limit(20)
            }
            .decodeList<ClubEvent>()
    }.getOrElse { emptyList() }

    /**
     * Featured DJs for a club — each active `club_dj_sets` row joined to its
     * catalogue row, in the curated `sort` order.
     */
    suspend fun featuredDjs(clubId: String): List<FeaturedDJ> = runCatching {
        supabase.client.postgrest.from("club_dj_sets")
            .select(
                Columns.raw(
                    "residency_label, night, " +
                        "dj:djs ( ra_artist_id, name, genres, instagram, soundcloud, website, " +
                        "known_venues, regions, bio, ra_url, image_url, cover_image_url, ra_followers )",
                ),
            ) {
                filter {
                    eq("club_id", clubId)
                    eq("is_active", true)
                }
                order("sort", Order.ASCENDING)
            }
            .decodeList<ClubDjSetRow>()
            .mapNotNull { it.toFeaturedDj() }
    }.getOrElse { emptyList() }

    /**
     * Resolve lineup credits to their `djs` rows BY RA ARTIST ID — the exact
     * join. A night billing two DJs of the same name resolves each correctly,
     * and a renamed artist still matches.
     */
    suspend fun djsByIds(ids: List<String>): List<FeaturedDJ> {
        if (ids.isEmpty()) return emptyList()
        return runCatching {
            supabase.client.postgrest.from("djs")
                .select(
                    Columns.raw(
                        "ra_artist_id, name, genres, instagram, soundcloud, website, " +
                            "known_venues, regions, bio, ra_url, image_url, cover_image_url, ra_followers",
                    ),
                ) { filter { isIn("ra_artist_id", ids) } }
                .decodeList<DjCatalogueRow>()
                .map { it.toFeaturedDj() }
        }.getOrElse { emptyList() }
    }

    /**
     * Catalogue rows matched by NAME.
     *
     * Only ever a fallback for legacy credits carrying no artist id — two DJs
     * can share a name but not an id, so an id match is exact and this one is a
     * guess. The caller resolves ids first and comes here only for what is left.
     */
    suspend fun djsByNames(names: List<String>): List<FeaturedDJ> {
        if (names.isEmpty()) return emptyList()
        return runCatching {
            supabase.client.postgrest.from("djs")
                .select(
                    Columns.raw(
                        "ra_artist_id, name, genres, instagram, soundcloud, website, " +
                            "known_venues, regions, bio, ra_url, image_url, cover_image_url, ra_followers",
                    ),
                ) { filter { isIn("name", names) } }
                .decodeList<DjCatalogueRow>()
                .map { it.toFeaturedDj() }
        }.getOrElse { emptyList() }
    }

    /**
     * A DJ's upcoming dated appearances — EVERY city they play, not just
     * Barcelona. The app owns this timeline outright: no upstream round-trip,
     * and no link out.
     */
    suspend fun djSchedule(raArtistId: String): List<DjGig> = runCatching {
        val today = java.time.LocalDate.now(java.time.ZoneId.of("Europe/Madrid")).toString()
        supabase.client.postgrest.from("dj_appearances")
            .select(
                Columns.raw("ra_event_id, title, date, start_time, venue_name, city, country, club_id"),
            ) {
                filter {
                    eq("ra_artist_id", raArtistId)
                    gte("date", today)
                }
                order("date", Order.ASCENDING)
                limit(30)
            }
            .decodeList<DjGig>()
    }.getOrElse { emptyList() }

    // ── Tickets ──────────────────────────────────────────────────────────────

    /**
     * The signed-in user's bookings, guest-list signups and ticket orders.
     *
     * IMPORTANT: this MUST go through PostgREST, not GET /api/bookings. That
     * REST route reads with the cookie session, which a native Bearer request
     * does not have, so RLS returns nothing.
     *
     * `scan_token` is NOT optional here: it is the only token the door accepts,
     * so a response without it yields passes that cannot scan. An earlier iOS
     * version retried without the column on error, which turned a migration
     * blip into silently unscannable tickets — far worse than a visible failure.
     */
    suspend fun myBookings(): BookingsResponse = coroutineScope {
        val uid = supabase.currentUserId()
            ?: return@coroutineScope BookingsResponse()

        val bookings = async {
            runCatching {
                supabase.client.postgrest.from("bookings").select(
                    Columns.raw(
                        """
                        id, booking_type, party_size, booking_date, arrival_window,
                        status, total_amount, qr_code_token, scan_token, created_at,
                        attendance_status, attendance_confidence, checked_in_at,
                        clubs (id, name, cover_image_url, address, neighborhood, lat, lng, opening_hours),
                        partner_brands (key, name, logo_url, color, attribution_label)
                        """.trimIndent().replace("\n", " "),
                    ),
                ) {
                    filter { eq("user_id", uid) }
                    order("booking_date", Order.DESCENDING)
                }.decodeList<Booking>()
            }.getOrElse { emptyList() }
        }

        val signups = async {
            runCatching {
                supabase.client.postgrest.from("guest_list_signups").select(
                    Columns.raw(
                        """
                        id, full_name, party_size, status, tier, checked_in, created_at,
                        guest_lists (id, event_name, event_date, cutoff_time, free_entry_label,
                          clubs (id, name, neighborhood))
                        """.trimIndent().replace("\n", " "),
                    ),
                ) {
                    filter { eq("user_id", uid) }
                    order("created_at", Order.DESCENDING)
                }.decodeList<GuestSignup>()
            }.getOrElse { emptyList() }
        }

        val tickets = async {
            runCatching {
                supabase.client.postgrest.from("ticket_orders").select(
                    Columns.raw(
                        """
                        id, event_name, venue_name, venue_place_id, event_date,
                        quantity, base_price_cents, markup_cents, total_cents,
                        status, created_at
                        """.trimIndent().replace("\n", " "),
                    ),
                ) {
                    filter { eq("user_id", uid) }
                    order("created_at", Order.DESCENDING)
                }.decodeList<TicketOrder>()
            }.getOrElse { emptyList() }
        }

        BookingsResponse(bookings.await(), signups.await(), tickets.await())
    }

    // ── Feed signals ─────────────────────────────────────────────────────────

    /**
     * Upcoming ticketed events: future rows only, soonest first. Public data —
     * no session needed, so guests get the same event-boosted ordering as
     * signed-in users.
     */
    suspend fun upcomingEvents(): List<ExternalEvent> = runCatching {
        supabase.client.postgrest.from("ra_events")
            .select(Columns.raw("id, title, venue_name, date")) {
                filter { gte("event_date", java.time.Instant.now().toString()) }
                order("event_date", Order.ASCENDING)
                limit(200)
            }
            .decodeList<ExternalEvent>()
    }.getOrElse { emptyList() }

    /**
     * Club ids that currently have a Featured DJ (an active club_dj_sets slot).
     * Used to boost programmed venues in the explore ranking.
     */
    suspend fun djClubIds(): Set<String> = runCatching {
        @kotlinx.serialization.Serializable
        data class Row(@kotlinx.serialization.SerialName("club_id") val clubId: String)
        supabase.client.postgrest.from("club_dj_sets")
            .select(Columns.list("club_id")) { filter { eq("is_active", true) } }
            .decodeList<Row>()
            .map { it.clubId }
            .toSet()
    }.getOrElse { emptySet() }

    // ── Personalisation inputs ───────────────────────────────────────────────
    // All return null for guests or on any failure — the feed renders
    // unpersonalised rather than blocking.

    suspend fun userPreferences(): UserPreferences? {
        val uid = supabase.currentUserId() ?: return null
        return runCatching {
            @kotlinx.serialization.Serializable
            data class Row(val preferences: UserPreferences? = null)
            supabase.client.postgrest.from("users")
                .select(Columns.list("preferences")) {
                    filter { eq("id", uid) }
                    limit(1)
                }
                .decodeList<Row>()
                .firstOrNull()?.preferences
        }.getOrNull()
    }

    /**
     * The computed taste profile row. Table is user_taste_profile, SINGULAR —
     * the plural name does not exist in the production catalog.
     *
     * (Survey preferences deliberately have NO direct query: the derivation
     * lives server-side in GET /api/surveys/preferences so web and native score
     * identical signals.)
     */
    suspend fun tasteProfile(): TasteProfile? {
        val uid = supabase.currentUserId() ?: return null
        return runCatching {
            supabase.client.postgrest.from("user_taste_profile")
                .select(Columns.raw("top_neighborhoods, top_genres, top_vibes")) {
                    filter { eq("user_id", uid) }
                    limit(1)
                }
                .decodeList<TasteProfile>()
                .firstOrNull()
        }.getOrNull()
    }

    // ── Favorites (mirror of the place_favorites helpers) ────────────────────

    suspend fun placeFavoriteIds(): Set<String> {
        val uid = supabase.currentUserId() ?: return emptySet()
        return runCatching {
            supabase.client.postgrest.from("place_favorites")
                .select(Columns.list("place_id")) {
                    filter { eq("user_id", uid) }
                    order("created_at", Order.DESCENDING)
                }
                .decodeList<PlaceFavorite>()
                .map { it.placeId.lowercase() }
                .toSet()
        }.getOrElse { emptySet() }
    }

    suspend fun savePlaceFavorite(place: Place) {
        val uid = supabase.currentUserId() ?: throw IllegalStateException("not signed in")
        val row = buildJsonObject {
            put("user_id", uid)
            put("place_id", place.placeId)
            put("name", place.name)
            put("address", place.address)
            place.coverPhoto?.let { put("cover_photo", it) }
            place.rating?.let { put("rating", it) }
        }
        supabase.client.postgrest.from("place_favorites")
            .upsert(row) { onConflict = "user_id,place_id" }
    }

    suspend fun removePlaceFavorite(placeId: String) {
        val uid = supabase.currentUserId() ?: throw IllegalStateException("not signed in")
        supabase.client.postgrest.from("place_favorites").delete {
            filter {
                eq("user_id", uid)
                eq("place_id", placeId)
            }
        }
    }
}
