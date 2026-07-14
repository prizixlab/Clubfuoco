import Foundation
import Supabase

@MainActor
final class PromoterRepo: ObservableObject {
    private let sb = SupabaseService.shared

    func myAllocations() async throws -> [PromoterAllocation] {
        var allocs: [PromoterAllocation] = try await sb.client
            .from("promoter_allocations")
            .select("""
                id, night_id, promoter_id, spots, payout_per_guest, payout_status,
                group_visible, invite_token,
                guests:promoter_guests ( id, plus_ones, checked_in_at ),
                night:promoter_nights (
                    id, club_id, title, night_date, doors_at, open_time, close_time,
                    total_capacity, is_published,
                    location_name, address, lat, lng, auto_checkin,
                    description, theme, photo_urls, featured, max_plus_ones,
                    club:clubs ( id, name )
                )
            """)
            .order("night_date", ascending: true, referencedTable: "promoter_nights")
            .execute()
            .value
        // Sort newest first by night_date for the activity feed
        allocs.sort { ($0.night?.nightDate ?? "") > ($1.night?.nightDate ?? "") }
        return allocs
    }

    func guests(allocationId: UUID) async throws -> [PromoterGuest] {
        try await sb.client
            .from("promoter_guests")
            .select()
            .eq("allocation_id", value: allocationId)
            .order("created_at", ascending: false)
            .execute()
            .value
    }

    func addGuest(_ g: NewGuest) async throws -> PromoterGuest {
        try await sb.client
            .from("promoter_guests")
            .insert(g)
            .select()
            .single()
            .execute()
            .value
    }

    func toggleCheckIn(guestId: UUID, checkedIn: Bool) async throws {
        struct Patch: Encodable { let checkedInAt: Date? }
        try await sb.client
            .from("promoter_guests")
            .update(Patch(checkedInAt: checkedIn ? Date() : nil))
            .eq("id", value: guestId)
            .execute()
    }

    func setGroupVisible(allocationId: UUID, visible: Bool) async throws {
        struct Patch: Encodable { let groupVisible: Bool }
        try await sb.client
            .from("promoter_allocations")
            .update(Patch(groupVisible: visible))
            .eq("id", value: allocationId)
            .execute()
    }

    func deleteAllocation(allocationId: UUID) async throws {
        try await sb.client
            .from("promoter_allocations")
            .delete()
            .eq("id", value: allocationId)
            .execute()
    }

    func deleteGuest(guestId: UUID) async throws {
        try await sb.client
            .from("promoter_guests")
            .delete()
            .eq("id", value: guestId)
            .execute()
    }

    // MARK: - Promoter applications

    func myApplication() async throws -> PromoterApplication? {
        let rows: [PromoterApplication] = try await sb.client
            .from("promoter_applications")
            .select("id,user_id,instagram,clubs,experience,status,ig_code,ig_verified,created_at")
            .eq("user_id", value: try await sb.client.auth.session.user.id)
            .limit(1)
            .execute()
            .value
        return rows.first
    }

    /// Finalize a promoter signup: mark the account a promoter kind, generate
    /// the Instagram verification code, file the application. Returns the code.
    func finalizePromoterSignup(instagram: String, clubs: String, experience: String) async throws -> String {
        let token = try await sb.client.auth.session.accessToken
        struct Body: Encodable { let instagram: String; let clubs: String; let experience: String }
        var req = URLRequest(url: URL(string: "\(Self.webBase)/api/promoter-signup/finalize")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(Body(instagram: instagram, clubs: clubs, experience: experience))
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Env: Decodable { let data: Payload?; let error: String? }
        struct Payload: Decodable { let igCode: String }
        let env = try JSONDecoder().decode(Env.self, from: data)
        guard let code = env.data?.igCode else { throw NSError(domain: "Signup", code: 1) }
        return code
    }

    struct NewApplication: Encodable {
        let userId: UUID
        let instagram: String?
        let clubs: String?
        let experience: String?
    }

    func submitApplication(_ a: NewApplication) async throws -> PromoterApplication {
        // upsert on the unique user_id so re-submitting (after a rejection or
        // an edit) replaces the prior row.
        try await sb.client
            .from("promoter_applications")
            .upsert(a, onConflict: "user_id")
            .select("id,user_id,instagram,clubs,experience,status,created_at")
            .single()
            .execute()
            .value
    }

    // MARK: - Series (permanent recurring links)

    private static let webBase = "https://clubfuoco.com"

    struct NewSeries: Encodable {
        let promoterId: UUID
        let clubId: UUID?
        let title: String?
        let weekdays: [Int]
        let openTime: String?
        let closeTime: String?
        let spots: Int
        let payoutPerGuest: Decimal
        let groupVisible: Bool
        let locationName: String?
        let address: String?
        let lat: Double?
        let lng: Double?
        let autoCheckin: Bool
        let description: String?
        let theme: String?
        let themeTranslate: Bool
        let photoUrls: [String]
        let featured: Bool
        let maxPlusOnes: Int?
    }

    // MARK: - Staff referral links

    func referrals(allocationId: UUID?, seriesId: UUID?) async throws -> [PromoterReferral] {
        var q = sb.client.from("promoter_referrals").select("id,label,token")
        if let seriesId { q = q.eq("series_id", value: seriesId) }
        else if let allocationId { q = q.eq("allocation_id", value: allocationId) }
        return try await q.order("created_at", ascending: true).execute().value
    }

    struct NewReferral: Encodable {
        let promoterId: UUID
        let label: String
        let allocationId: UUID?
        let seriesId: UUID?
    }

    func createReferral(label: String, allocationId: UUID?, seriesId: UUID?) async throws -> PromoterReferral {
        let uid = try await sb.client.auth.session.user.id
        return try await sb.client
            .from("promoter_referrals")
            .insert(NewReferral(promoterId: uid, label: label,
                                allocationId: seriesId == nil ? allocationId : nil,
                                seriesId: seriesId))
            .select("id,label,token")
            .single()
            .execute()
            .value
    }

    func deleteReferral(id: UUID) async throws {
        try await sb.client.from("promoter_referrals").delete().eq("id", value: id).execute()
    }

    // MARK: - Promoter brand profile

    func getProfile() async throws -> PromoterProfileRow? {
        let uid = try await sb.client.auth.session.user.id
        let rows: [PromoterProfileRow] = try await sb.client
            .from("promoter_profiles")
            .select("user_id,brand_name,logo_url,bio,instagram")
            .eq("user_id", value: uid)
            .limit(1)
            .execute()
            .value
        return rows.first
    }

    struct ProfilePatch: Encodable {
        let userId: UUID
        let brandName: String?
        let logoUrl: String?
        let bio: String?
        let instagram: String?
        let animateLogo: Bool
        let updatedAt: String
    }

    func saveProfile(brandName: String?, logoUrl: String?, bio: String?, instagram: String?,
                     animateLogo: Bool = false) async throws {
        let uid = try await sb.client.auth.session.user.id
        let f = ISO8601DateFormatter()
        try await sb.client
            .from("promoter_profiles")
            .upsert(ProfilePatch(userId: uid, brandName: brandName, logoUrl: logoUrl,
                                 bio: bio, instagram: instagram, animateLogo: animateLogo,
                                 updatedAt: f.string(from: Date())),
                    onConflict: "user_id")
            .execute()
    }

    // MARK: - Billing (front-page promotion card on file)

    struct BillingStatus: Decodable, Sendable {
        let cardVerified: Bool
        let cardBrand: String?
        let cardLast4: String?
        let balanceCents: Int
        let status: String   // active | past_due | blocked
    }

    func billingStatus() async throws -> BillingStatus {
        let token = try await sb.client.auth.session.accessToken
        var req = URLRequest(url: URL(string: "\(Self.webBase)/api/promoter-billing/status")!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Env: Decodable { let data: BillingStatus? }
        let dec = JSONDecoder()
        guard let s = (try dec.decode(Env.self, from: data)).data else {
            throw NSError(domain: "Billing", code: 1)
        }
        return s
    }

    /// Returns the Stripe-hosted card-setup URL to open in a browser.
    func billingSetupURL() async throws -> URL {
        let token = try await sb.client.auth.session.accessToken
        var req = URLRequest(url: URL(string: "\(Self.webBase)/api/promoter-billing/setup")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Env: Decodable { let data: Payload? }
        struct Payload: Decodable { let url: String }
        guard let s = (try JSONDecoder().decode(Env.self, from: data)).data?.url,
              let url = URL(string: s) else { throw NSError(domain: "Billing", code: 2) }
        return url
    }

    /// Upload a logo JPEG using the signed-in promoter's id for the path.
    func uploadLogo(_ jpeg: Data) async throws -> String {
        let uid = try await sb.client.auth.session.user.id
        return try await uploadEventPhoto(jpeg, promoterId: uid)
    }

    /// Upload a JPEG to the public event-photos bucket, return its public URL.
    func uploadEventPhoto(_ jpeg: Data, promoterId: UUID) async throws -> String {
        let path = "\(promoterId.uuidString.lowercased())/\(UUID().uuidString).jpg"
        try await sb.client.storage.from("event-photos")
            .upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg"))
        return try sb.client.storage.from("event-photos").getPublicURL(path: path).absoluteString
    }

    func createSeries(_ s: NewSeries) async throws -> PromoterSeries {
        try await sb.client
            .from("promoter_series")
            .insert(s)
            .select("""
                id, club_id, title, weekdays, open_time, close_time, spots,
                payout_per_guest, group_visible, invite_token, is_active,
                location_name, address, lat, lng, auto_checkin,
                description, theme, photo_urls, featured, max_plus_ones,
                club:clubs ( id, name )
            """)
            .single()
            .execute()
            .value
    }

    func mySeries() async throws -> [PromoterSeries] {
        try await sb.client
            .from("promoter_series")
            .select("""
                id, club_id, title, weekdays, open_time, close_time, spots,
                payout_per_guest, group_visible, invite_token, is_active,
                location_name, address, lat, lng, auto_checkin,
                description, theme, photo_urls, featured, max_plus_ones,
                club:clubs ( id, name )
            """)
            .eq("is_active", value: true)
            .order("created_at", ascending: false)
            .execute()
            .value
    }

    /// Update a series' default visibility (applies to all future occurrences).
    func setSeriesGroupVisible(token: String, visible: Bool) async throws {
        struct Patch: Encodable { let groupVisible: Bool }
        try await sb.client
            .from("promoter_series")
            .update(Patch(groupVisible: visible))
            .eq("invite_token", value: token)
            .execute()
    }

    func deleteSeries(seriesId: UUID) async throws {
        try await sb.client
            .from("promoter_series")
            .delete()
            .eq("id", value: seriesId)
            .execute()
    }

    /// Resolve + materialize this series' current occurrence (server-side) and
    /// return the concrete allocation, ready to push into GuestlistView.
    func currentAllocation(forSeries seriesId: UUID) async throws -> PromoterAllocation {
        guard let token = try? await sb.client.auth.session.accessToken else {
            throw URLError(.userAuthenticationRequired)
        }
        var req = URLRequest(url: URL(string: "\(Self.webBase)/api/promoter-series/\(seriesId.uuidString.lowercased())/current")!)
        req.httpMethod = "GET"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Env: Decodable { let data: Payload?; let error: String? }
        struct Payload: Decodable { let allocationId: UUID }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let env = try decoder.decode(Env.self, from: data)
        guard let allocId = env.data?.allocationId else {
            throw NSError(domain: "PromoterRepo", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: env.error ?? "Couldn't open this week's list"])
        }
        return try await allocation(byId: allocId)
    }

    func allocation(byId id: UUID) async throws -> PromoterAllocation {
        try await sb.client
            .from("promoter_allocations")
            .select("""
                id, night_id, promoter_id, spots, payout_per_guest, payout_status,
                group_visible, invite_token,
                guests:promoter_guests ( id, plus_ones, checked_in_at ),
                night:promoter_nights (
                    id, club_id, title, night_date, doors_at, open_time, close_time,
                    total_capacity, is_published,
                    location_name, address, lat, lng, auto_checkin,
                    description, theme, photo_urls, featured, max_plus_ones,
                    club:clubs ( id, name )
                )
            """)
            .eq("id", value: id)
            .single()
            .execute()
            .value
    }

    func barcelonaClubs() async throws -> [Club] {
        // Scope by a Barcelona-metro coordinate box, NOT `address ILIKE
        // '%Barcelona%'` — that string filter silently dropped venues whose
        // address omits the city (Sala Apolo, Jamboree, BARTS, Macarena,
        // Eclipse). Every active club has coordinates and all sit inside this
        // box, so this includes them all and stays robust to address typos.
        try await sb.client
            .from("clubs")
            .select("id,name")
            .eq("is_active", value: true)
            .gte("lat", value: 41.2).lte("lat", value: 41.55)
            .gte("lng", value: 1.9).lte("lng", value: 2.4)
            .order("name", ascending: true)
            .execute()
            .value
    }

    struct NewNight: Encodable {
        let clubId: UUID?
        let title: String?
        let nightDate: String   // yyyy-MM-dd
        let openTime: String?   // "HH:mm:ss"
        let closeTime: String?  // "HH:mm:ss"
        let totalCapacity: Int
        let locationName: String?
        let address: String?
        let lat: Double?
        let lng: Double?
        let autoCheckin: Bool
        let description: String?
        let theme: String?
        let themeTranslate: Bool
        let photoUrls: [String]
        let featured: Bool
        let maxPlusOnes: Int?
    }
    struct NewAllocation: Encodable {
        let nightId: UUID
        let promoterId: UUID
        let spots: Int
        let payoutPerGuest: Decimal
        let groupVisible: Bool
    }

    /// A resolved event location — a partner club OR a custom pin.
    struct EventLocation {
        var clubId: UUID? = nil
        var name: String? = nil
        var address: String? = nil
        var lat: Double? = nil
        var lng: Double? = nil
    }

    /// Creates one night + self-allocation per date in `dates`.
    /// Returns the first allocation (so the caller can navigate into the
    /// earliest one).
    func createSelfGuestlist(
        location: EventLocation, title: String?, dates: [String],
        openTime: String?, closeTime: String?,
        spots: Int, payoutPerGuest: Decimal,
        groupVisible: Bool, autoCheckin: Bool,
        description: String?, theme: String?, themeTranslate: Bool, photoUrls: [String],
        featured: Bool, maxPlusOnes: Int?, promoterId: UUID
    ) async throws -> PromoterAllocation {
        let nightPayload = dates.map {
            NewNight(clubId: location.clubId, title: title, nightDate: $0,
                     openTime: openTime, closeTime: closeTime,
                     totalCapacity: max(spots, 50),
                     locationName: location.name, address: location.address,
                     lat: location.lat, lng: location.lng, autoCheckin: autoCheckin,
                     description: description, theme: theme,
                     themeTranslate: themeTranslate, photoUrls: photoUrls, featured: featured,
                     maxPlusOnes: maxPlusOnes)
        }
        let nights: [PromoterNight] = try await sb.client
            .from("promoter_nights")
            .insert(nightPayload)
            .select("id,club_id,title,night_date,doors_at,open_time,close_time,total_capacity,is_published,location_name,address,lat,lng,auto_checkin,description,theme,photo_urls,featured,max_plus_ones")
            .execute()
            .value

        let allocPayload = nights.map {
            NewAllocation(nightId: $0.id, promoterId: promoterId,
                          spots: spots, payoutPerGuest: payoutPerGuest,
                          groupVisible: groupVisible)
        }
        let allocs: [PromoterAllocation] = try await sb.client
            .from("promoter_allocations")
            .insert(allocPayload)
            .select("""
                id, night_id, promoter_id, spots, payout_per_guest, payout_status,
                group_visible, invite_token,
                guests:promoter_guests ( id, plus_ones, checked_in_at ),
                night:promoter_nights (
                    id, club_id, title, night_date, doors_at, open_time, close_time,
                    total_capacity, is_published,
                    location_name, address, lat, lng, auto_checkin,
                    description, theme, photo_urls, featured, max_plus_ones,
                    club:clubs ( id, name )
                )
            """)
            .execute()
            .value

        // Return the earliest by night_date
        return allocs.sorted { ($0.night?.nightDate ?? "") < ($1.night?.nightDate ?? "") }.first
            ?? allocs.first!
    }
}
