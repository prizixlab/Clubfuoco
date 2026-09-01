import Foundation
import Supabase

/// Native mirror of src/lib/supabase/queries.ts — the surfaces the current
/// iOS app reads straight from PostgREST under RLS instead of via the REST
/// API. Phase 0 ports only what the auth flow needs; the rest (events,
/// rumbas, notifications, preferences, favorites…) lands with their screens.
final class Queries: @unchecked Sendable {
    private let supabase: SupabaseService

    init(supabase: SupabaseService) {
        self.supabase = supabase
    }

    /// Mirror of getMe(): the signed-in user's `users` row.
    /// (`/api/auth/me` is cookie-only and 401s for Bearer requests — the
    /// web app's native path uses this exact direct query instead.)
    func me() async throws -> UserProfile? {
        guard let session = await supabase.currentSession() else { return nil }
        return try await supabase.client
            .from("users")
            .select()
            .eq("id", value: session.user.id.uuidString)
            .single()
            .execute()
            .value
    }

    /// Update the signed-in user's `users` row (RLS-scoped) — used by
    /// complete-profile, the signup birthday step, and OAuth name capture.
    func updateMe(_ updates: [String: AnyJSON]) async throws {
        guard let session = await supabase.currentSession() else { return }
        try await supabase.client
            .from("users")
            .update(updates)
            .eq("id", value: session.user.id.uuidString)
            .execute()
    }

    // ── Explore feed (mirrors getNearbyClubs) ─────────────────────────────────

    /// Clubs within `radius` metres of (lat, lng) — same bounding-box select,
    /// ordering and photo gating as the web feed.
    func nearbyClubs(lat: Double, lng: Double, radius: Double) async throws -> [Place] {
        let latDelta = radius / 111_000
        let lngDelta = radius / 85_000

        // Feed cards only render the cover photo, so the query skips the heavy
        // `gallery_urls` array (the detail screen re-fetches it via clubById).
        // cover_image_url + photos supplies the cover and the photoless filter
        // for every active venue — verified none rely on gallery_urls alone.
        let rows: [NearbyClubRow] = try await supabase.client
            .from("clubs")
            .select("""
                id, name, slug, address, neighborhood, \
                lat, lng, cover_image_url, photos, \
                rating, ratings_total, music_genres, google_place_id, \
                general_entry_price, vip_table_min_spend, opening_hours, \
                is_featured, is_partner, \
                live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ), \
                club_tags ( tag, category )
                """)
            .eq("is_active", value: true)
            .not("lat", operator: .is, value: "null")
            .gte("lat", value: lat - latDelta).lte("lat", value: lat + latDelta)
            .gte("lng", value: lng - lngDelta).lte("lng", value: lng + lngDelta)
            .order("is_featured", ascending: false)
            .order("is_partner", ascending: false)
            .order("ratings_total", ascending: false, nullsFirst: false)
            .order("rating", ascending: false, nullsFirst: false)
            .limit(500)
            .execute()
            .value

        // Photoless venues are held back until they have real imagery.
        return rows.map { $0.toPlace() }.filter { !$0.photos.isEmpty }
    }

    /// Full club rows for a set of ids — used by the Saved (hearted) clubs page.
    /// Unlike the feed, photoless venues are kept: the user explicitly saved them.
    func clubsByIds(_ ids: [String]) async throws -> [Place] {
        guard !ids.isEmpty else { return [] }
        let rows: [NearbyClubRow] = try await supabase.client
            .from("clubs")
            .select("""
                id, name, slug, address, neighborhood, \
                lat, lng, cover_image_url, gallery_urls, photos, \
                rating, ratings_total, music_genres, google_place_id, \
                general_entry_price, vip_table_min_spend, opening_hours, \
                is_featured, is_partner, \
                live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ), \
                club_tags ( tag, category )
                """)
            .in("id", values: ids)
            .order("rating", ascending: false, nullsFirst: false)
            .execute()
            .value
        return rows.map { $0.toPlace() }
    }

    /// The signed-in user's bookings, guest-list signups and ticket orders —
    /// native mirror of getMyBookings() in src/lib/supabase/queries.ts.
    ///
    /// IMPORTANT: this MUST go through PostgREST (not GET /api/bookings). That
    /// REST route reads with the cookie session, which a native Bearer request
    /// doesn't have, so RLS returns nothing. The direct query runs as the real
    /// signed-in user, so RLS (`auth.uid() = user_id`) passes.
    /// Bookings select. `scan_token` is NOT optional here: it is the only token
    /// the door accepts, so a response without it yields passes that cannot
    /// scan. This used to retry without the column on error, which turned a
    /// migration blip into silently unscannable tickets — far worse than a
    /// visible failure. The column is deployed and DB-defaulted, so ask for it
    /// and let a genuine error surface.
    private static func bookingsQuery(_ supabase: SupabaseService, uid: String) async throws -> [Booking] {
        let cols = """
            id, booking_type, party_size, booking_date, arrival_window, \
            status, total_amount, qr_code_token, scan_token, created_at, \
            attendance_status, attendance_confidence, checked_in_at, \
            clubs (id, name, cover_image_url, address, neighborhood, lat, lng, opening_hours), \
            partner_brands (key, name, logo_url, color, attribution_label), \
            promoter_nights (id, title, open_time, close_time, lineup, hosts)
            """
        return try await supabase.client.from("bookings").select(cols)
            .eq("user_id", value: uid)
            .order("booking_date", ascending: false)
            .execute().value
    }

    func myBookings() async throws -> BookingsResponse {
        // currentSession() (not a bare try?) — a dead refresh token must sign
        // the user out, not render a silently-empty Tickets page.
        guard let session = await supabase.currentSession() else {
            return BookingsResponse(bookings: [], guestSignups: [], ticketOrders: [])
        }
        let uid = session.user.id.uuidString

        async let bookings: [Booking] = Self.bookingsQuery(supabase, uid: uid)

        async let signups: [GuestSignup] = supabase.client
            .from("guest_list_signups")
            .select("""
                id, full_name, party_size, status, tier, checked_in, created_at, \
                guest_lists (id, event_name, event_date, cutoff_time, free_entry_label, \
                  clubs (id, name, neighborhood))
                """)
            .eq("user_id", value: uid)
            .order("created_at", ascending: false)
            .execute().value

        async let tickets: [TicketOrder] = supabase.client
            .from("ticket_orders")
            .select("""
                id, event_name, venue_name, venue_place_id, event_date, \
                quantity, base_price_cents, markup_cents, total_cents, \
                status, created_at
                """)
            .eq("user_id", value: uid)
            .order("created_at", ascending: false)
            .execute().value

        return try await BookingsResponse(bookings: bookings, guestSignups: signups, ticketOrders: tickets)
    }

    /// Full club row for the detail screen (mirrors getClubById).
    func clubById(_ id: String) async throws -> PlaceDetail? {
        let rows: [PlaceDetailRow] = try await supabase.client
            .from("clubs")
            .select("""
                id, name, slug, address, neighborhood, \
                lat, lng, cover_image_url, gallery_urls, photos, \
                rating, ratings_total, music_genres, google_place_id, \
                description, instagram_handle, whatsapp_link, \
                general_entry_price, vip_table_min_spend, \
                opening_hours, is_featured, is_partner, is_active, \
                live_status ( is_open, crowd_percentage, crowd_label, current_dj, queue_wait_minutes ), \
                club_tags ( tag, category )
                """)
            .eq("id", value: id)
            .limit(1)
            .execute()
            .value
        return rows.first?.toDetail()
    }

    /// Upcoming events at ONE venue, for the club detail screen (mirrors
    /// getClubEvents in queries.ts). Joined on club_id — resolved at ingest —
    /// not on venue name, so one rooftop's event can't appear on another's
    /// page. Past events stay in the table as history and are filtered here.
    func clubEvents(clubId: String) async throws -> [ClubEvent] {
        let today = DateFormatter()
        today.dateFormat = "yyyy-MM-dd"
        today.timeZone = TimeZone(identifier: "Europe/Madrid")
        return try await supabase.client
            .from("events")
            .select("ra_event_id, title, date, start_time, end_time, venue_name, promoters, artists, lineup, interested, attending, ra_url, image, description, minimum_age, venue_capacity, cost")
            .eq("club_id", value: clubId)
            // Events that are really just a lone DJ playing are hidden here and
            // surfaced as a Featured DJ box instead (see link_djs.py).
            .eq("is_dj_set", value: false)
            .gte("date", value: today.string(from: Date()))
            .order("date", ascending: true)
            .limit(20)
            .execute()
            .value
    }

    /// Featured DJs for a club — the "this slot is a DJ set, not an event" case
    /// (see supabase/migrations/djs.sql). Each active club_dj_sets row is joined
    /// to its djs catalogue row; ordered by the curated `sort`.
    func featuredDJs(clubId: String) async throws -> [FeaturedDJ] {
        try await supabase.client
            .from("club_dj_sets")
            .select("""
                residency_label, night, \
                dj:djs ( ra_artist_id, name, genres, instagram, soundcloud, website, \
                         known_venues, regions, bio, ra_url, image_url, cover_image_url, ra_followers )
                """)
            .eq("club_id", value: clubId)
            .eq("is_active", value: true)
            .order("sort", ascending: true)
            .execute()
            .value
    }

    /// A DJ's upcoming dated appearances — EVERY city they play, not just
    /// Barcelona, scraped per artist into `dj_appearances`. The app owns this
    /// timeline outright: no Resident Advisor round-trip, and no link out.
    ///
    /// `club_id` is set only for venues we carry; rows in cities we have not
    /// launched still appear (a DJ touring is signal, not a gap) and the UI
    /// offers a "coming soon" note for that city rather than a dead link.
    func djSchedule(raArtistId: String) async throws -> [DJGig] {
        let today = DateFormatter()
        today.dateFormat = "yyyy-MM-dd"
        today.timeZone = TimeZone(identifier: "Europe/Madrid")
        return try await supabase.client
            .from("dj_appearances")
            .select("ra_event_id, title, date, start_time, venue_name, city, country, club_id")
            .eq("ra_artist_id", value: raArtistId)
            .gte("date", value: today.string(from: Date()))
            .order("date", ascending: true)
            .limit(30)
            .execute()
            .value
    }

    /// Resolve lineup credits to their `djs` rows BY RA ARTIST ID — the exact
    /// join. `events.lineup` carries RA's id per credit, and `djs` is keyed on
    /// the same id, so a night billing two DJs of the same name resolves each
    /// correctly and a renamed artist still matches.
    ///
    /// Prefer this over djsByNames, which is kept only for rows scraped before
    /// `lineup` existed.
    func djsByIds(_ ids: [String]) async throws -> [FeaturedDJ] {
        guard !ids.isEmpty else { return [] }
        let rows: [DJCatalogueRow] = try await supabase.client
            .from("djs")
            .select("""
                ra_artist_id, name, genres, instagram, soundcloud, website, \
                known_venues, regions, bio, ra_url, image_url, cover_image_url, ra_followers
                """)
            .in("ra_artist_id", values: ids)
            .execute()
            .value
        return rows.map(\.featuredDJ)
    }

    /// Resolve a set of lineup artist names to their `djs` catalogue rows, so an
    /// event box can link the DJs it lists to their pages. Only names present in
    /// the catalogue come back — an unknown name (a live act, a one-off) simply
    /// isn't tappable. No residency slot is involved, so the returned FeaturedDJ
    /// carries nil residency.
    func djsByNames(_ names: [String]) async throws -> [FeaturedDJ] {
        guard !names.isEmpty else { return [] }
        let rows: [DJCatalogueRow] = try await supabase.client
            .from("djs")
            .select("""
                ra_artist_id, name, genres, instagram, soundcloud, website, \
                known_venues, regions, bio, ra_url, image_url, cover_image_url, ra_followers
                """)
            .in("name", values: names)
            .execute()
            .value
        return rows.map(\.featuredDJ)
    }

    /// Flyer images for events, keyed by `ra_event_id`. `events` carries no
    /// artwork, but the ticketed `ra_events` cache does — its id is "ra_<id>".
    /// Only a subset of events overlap the ticket feed, so many come back
    /// imageless (the box then renders text-only).
    func eventImages(raEventIds: [String]) async throws -> [String: String] {
        guard !raEventIds.isEmpty else { return [:] }
        struct Row: Decodable { let id: String; let image: String? }
        let rows: [Row] = try await supabase.client
            .from("ra_events")
            .select("id, image")
            .in("id", values: raEventIds.map { "ra_\($0)" })
            .execute()
            .value
        var map: [String: String] = [:]
        for r in rows where r.image != nil {
            map[String(r.id.dropFirst(3))] = r.image   // strip "ra_"
        }
        return map
    }

    /// Club ids that currently have a Featured DJ (an active club_dj_sets slot).
    /// Used to boost programmed venues in the explore ranking.
    func djClubIds() async throws -> Set<String> {
        struct Row: Decodable { let clubId: String }
        let rows: [Row] = try await supabase.client
            .from("club_dj_sets")
            .select("club_id")
            .eq("is_active", value: true)
            .execute()
            .value
        return Set(rows.map(\.clubId))
    }

    /// Upcoming ticketed events (mirrors getEvents in queries.ts): future rows
    /// only, soonest first. Public data — no session needed, so guests get the
    /// same event-boosted ordering as signed-in users.
    func upcomingEvents() async throws -> [ExternalEvent] {
        try await supabase.client
            .from("ra_events")
            .select("id, title, venue_name, date")
            .gte("event_date", value: ISO8601DateFormatter().string(from: Date()))
            .order("event_date", ascending: true)
            .limit(200)
            .execute()
            .value
    }

    // ── Personalisation inputs (mirrors getUserPreferences /
    //    getSurveyPreferences / getTasteProfile) ─────────────────────────────
    // All three return nil for guests or on any failure — the feed renders
    // unpersonalised rather than blocking.

    /// The signed-in user's onboarding preferences JSON.
    func userPreferences() async throws -> UserPreferences? {
        guard let session = await supabase.currentSession() else { return nil }
        struct Row: Decodable { let preferences: UserPreferences? }
        let rows: [Row] = try await supabase.client
            .from("users")
            .select("preferences")
            .eq("id", value: session.user.id.uuidString)
            .limit(1)
            .execute()
            .value
        return rows.first?.preferences
    }

    // (Survey preferences deliberately have NO direct query here — the
    // derivation lives server-side in GET /api/surveys/preferences so web and
    // iOS score identical signals. ExploreViewModel fetches it via APIClient.)

    /// The computed taste profile row (bookings + surveys + tags).
    /// Table is user_taste_profile, SINGULAR — matching /api/me/taste-profile;
    /// the plural name doesn't exist in the production catalog.
    func tasteProfile() async throws -> TasteProfile? {
        guard let session = await supabase.currentSession() else { return nil }
        let rows: [TasteProfile] = try await supabase.client
            .from("user_taste_profile")
            .select("top_neighborhoods, top_genres, top_vibes")
            .eq("user_id", value: session.user.id.uuidString)
            .limit(1)
            .execute()
            .value
        return rows.first
    }

    // ── Favorites (mirror of place_favorites helpers) ─────────────────────────

    func placeFavoriteIds() async throws -> Set<String> {
        guard let session = await supabase.currentSession() else { return [] }
        let rows: [PlaceFavorite] = try await supabase.client
            .from("place_favorites")
            .select("place_id")
            .eq("user_id", value: session.user.id.uuidString)
            .order("created_at", ascending: false)
            .execute()
            .value
        return Set(rows.map { $0.placeId.lowercased() })
    }

    func savePlaceFavorite(_ place: Place) async throws {
        guard let session = await supabase.currentSession() else {
            throw APIError.unauthorized
        }
        var row: [String: AnyJSON] = [
            "user_id": .string(session.user.id.uuidString),
            "place_id": .string(place.placeId),
            "name": .string(place.name),
            "address": .string(place.address),
        ]
        row["cover_photo"] = place.coverPhoto.map { .string($0) } ?? .null
        row["rating"] = place.rating.map { .double($0) } ?? .null
        try await supabase.client
            .from("place_favorites")
            .upsert(row, onConflict: "user_id,place_id")
            .execute()
    }

    func removePlaceFavorite(placeId: String) async throws {
        guard let session = await supabase.currentSession() else {
            throw APIError.unauthorized
        }
        try await supabase.client
            .from("place_favorites")
            .delete()
            .eq("user_id", value: session.user.id.uuidString)
            .eq("place_id", value: placeId)
            .execute()
    }
}

/// A `djs` catalogue row. Shared by djsByIds and djsByNames so the column list
/// and the mapping live in one place.
struct DJCatalogueRow: Decodable, Sendable {
    let raArtistId: String
    let name: String
    let genres: [String]?
    let instagram: String?
    let soundcloud: String?
    let website: String?
    let knownVenues: [String]?
    let regions: [String]?
    let bio: String?
    let raUrl: String?
    let imageUrl: String?
    let coverImageUrl: String?
    let raFollowers: Int?

    var featuredDJ: FeaturedDJ {
        FeaturedDJ(raArtistId: raArtistId, name: name, genres: genres ?? [],
                   instagram: instagram, soundcloud: soundcloud, website: website,
                   knownVenues: knownVenues ?? [], regions: regions ?? [], bio: bio,
                   raUrl: raUrl, imageUrl: imageUrl, coverImageUrl: coverImageUrl,
                   raFollowers: raFollowers)
    }
}
