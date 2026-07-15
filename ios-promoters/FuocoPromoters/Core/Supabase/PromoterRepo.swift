import Foundation
import Supabase

@MainActor
final class PromoterRepo: ObservableObject {
    private let sb = SupabaseService.shared

    // ── Drift-defensive review columns ──────────────────────────────────────
    // Production drifts from supabase/migrations: review_status exists today,
    // rejection_reason and skipped_dates land with later manual migrations.
    // Selects start at the richest level and step down only when PostgREST
    // reports a missing column, so a screen never breaks on an unapplied
    // migration. Level 3 → + skipped_dates (series only), 2 → review_status +
    // rejection_reason, 1 → review_status, 0 → none.
    private static var reviewColumnLevel = 3

    private static func reviewCols(_ level: Int) -> String {
        switch level {
        case 2...: return ", review_status, rejection_reason"
        case 1:    return ", review_status"
        default:   return ""
        }
    }

    private static func nightSelect(_ level: Int) -> String {
        """
        id, club_id, title, night_date, doors_at, open_time, close_time,
        total_capacity, is_published,
        location_name, address, lat, lng, auto_checkin,
        description, theme, theme_translate, photo_urls, featured, max_plus_ones\(reviewCols(level))
        """
    }

    private static func allocationSelect(_ level: Int) -> String {
        """
        id, night_id, promoter_id, spots, payout_per_guest, payout_status,
        group_visible, invite_token,
        guests:promoter_guests ( id, plus_ones, checked_in_at ),
        night:promoter_nights (
            \(nightSelect(level)),
            club:clubs ( id, name )
        )
        """
    }

    private static func seriesSelect(_ level: Int) -> String {
        """
        id, club_id, title, weekdays, open_time, close_time, spots,
        payout_per_guest, group_visible, invite_token, is_active,
        location_name, address, lat, lng, auto_checkin,
        description, theme, theme_translate, photo_urls, featured, max_plus_ones\(level >= 3 ? ", skipped_dates" : "")\(reviewCols(level)),
        club:clubs ( id, name )
        """
    }

    /// Run `op` at the current review-column level; on a missing-column error
    /// step down a level and retry (remembering the level that worked).
    private func withReviewFallback<T>(_ op: (Int) async throws -> T) async throws -> T {
        var level = Self.reviewColumnLevel
        while true {
            do {
                let value = try await op(level)
                Self.reviewColumnLevel = level
                return value
            } catch {
                let msg = String(describing: error).lowercased()
                let missingColumn = msg.contains("does not exist")
                    || msg.contains("schema cache") || msg.contains("42703")
                guard missingColumn, level > 0 else { throw error }
                level -= 1
            }
        }
    }

    func myAllocations() async throws -> [PromoterAllocation] {
        var allocs: [PromoterAllocation] = try await withReviewFallback { level in
            try await sb.client
                .from("promoter_allocations")
                .select(Self.allocationSelect(level))
                .order("night_date", ascending: true, referencedTable: "promoter_nights")
                .execute()
                .value
        }
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
        try await withReviewFallback { level in
            try await sb.client
                .from("promoter_series")
                .insert(s)
                .select(Self.seriesSelect(level))
                .single()
                .execute()
                .value
        }
    }

    func mySeries() async throws -> [PromoterSeries] {
        try await withReviewFallback { level in
            try await sb.client
                .from("promoter_series")
                .select(Self.seriesSelect(level))
                .eq("is_active", value: true)
                .order("created_at", ascending: false)
                .execute()
                .value
        }
    }

    /// Edit an existing series. Content edits re-enter review — the patch
    /// resets review_status to 'pending' (the DB trigger enforces the same
    /// for any direct write, and the client can never self-approve).
    func updateSeries(seriesId: UUID, _ s: NewSeries) async throws {
        var patch: [String: AnyJSON] = [
            "title":            s.title.map(AnyJSON.string) ?? .null,
            "weekdays":         .array(s.weekdays.map { .integer($0) }),
            "open_time":        s.openTime.map(AnyJSON.string) ?? .null,
            "close_time":       s.closeTime.map(AnyJSON.string) ?? .null,
            "spots":            .integer(s.spots),
            "payout_per_guest": .double(NSDecimalNumber(decimal: s.payoutPerGuest).doubleValue),
            "group_visible":    .bool(s.groupVisible),
            "auto_checkin":     .bool(s.autoCheckin),
            "description":      s.description.map(AnyJSON.string) ?? .null,
            "theme":            s.theme.map(AnyJSON.string) ?? .null,
            "theme_translate":  .bool(s.themeTranslate),
            "photo_urls":       .array(s.photoUrls.map(AnyJSON.string)),
            "featured":         .bool(s.featured),
            "max_plus_ones":    s.maxPlusOnes.map { AnyJSON.integer($0) } ?? .null,
            "review_status":    .string("pending"),
        ]
        do {
            try await sb.client.from("promoter_series")
                .update(patch).eq("id", value: seriesId).execute()
        } catch {
            // Drift-defensive: review_status column missing → save the content
            // edit anyway rather than failing the whole save.
            let msg = String(describing: error).lowercased()
            guard msg.contains("does not exist") || msg.contains("schema cache") || msg.contains("42703") else { throw error }
            patch.removeValue(forKey: "review_status")
            try await sb.client.from("promoter_series")
                .update(patch).eq("id", value: seriesId).execute()
        }
    }

    /// Replace the set of skipped occurrence dates on a recurring series
    /// ("take a week off"). Scheduling, not content — the rehold trigger
    /// ignores this column, so it never re-enters review. Throws when the
    /// skipped_dates migration isn't applied yet; callers surface that.
    func updateSeriesSkippedDates(seriesId: UUID, dates: [String]) async throws {
        let patch: [String: AnyJSON] = ["skipped_dates": .array(dates.map(AnyJSON.string))]
        try await sb.client
            .from("promoter_series")
            .update(patch)
            .eq("id", value: seriesId)
            .execute()
    }

    /// Edit an existing night through the web API (service-role with an
    /// ownership check — night rows have no promoter-updatable RLS policy).
    /// The server flips the night back to pending review.
    func updateNight(nightId: UUID, body: [String: Any]) async throws {
        let token = try await sb.client.auth.session.accessToken
        var req = URLRequest(url: URL(string: "\(Self.webBase)/api/promoter-nights/\(nightId.uuidString.lowercased())")!)
        req.httpMethod = "PATCH"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            let msg = ((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String)
            throw NSError(domain: "PromoterRepo", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: msg ?? "Couldn't save your changes."])
        }
    }

    /// Update the promoter-owned allocation half of a night edit.
    func updateAllocation(allocationId: UUID, spots: Int, payoutPerGuest: Decimal, groupVisible: Bool) async throws {
        struct Patch: Encodable {
            let spots: Int
            let payoutPerGuest: Decimal
            let groupVisible: Bool
        }
        try await sb.client
            .from("promoter_allocations")
            .update(Patch(spots: spots, payoutPerGuest: payoutPerGuest, groupVisible: groupVisible))
            .eq("id", value: allocationId)
            .execute()
    }

    // MARK: - Push device tokens

    /// Persist this device's APNs token against the signed-in user. Fully
    /// defensive: the device_tokens table ships in a manual migration, so a
    /// failure here (table missing, RLS, offline) is silently ignored — push
    /// is a best-effort layer, never a blocker.
    func registerDeviceToken(_ token: String, environment: String) async {
        guard let uid = try? await sb.client.auth.session.user.id else { return }
        struct Row: Encodable {
            let userId: UUID
            let token: String
            let platform: String
            let app: String
            let environment: String
            let updatedAt: String
        }
        let row = Row(userId: uid, token: token, platform: "ios", app: "promoters",
                      environment: environment,
                      updatedAt: ISO8601DateFormatter().string(from: Date()))
        _ = try? await sb.client
            .from("device_tokens")
            .upsert(row, onConflict: "token")
            .execute()
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
        try await withReviewFallback { level in
            try await sb.client
                .from("promoter_allocations")
                .select(Self.allocationSelect(level))
                .eq("id", value: id)
                .single()
                .execute()
                .value
        }
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
        let nights: [PromoterNight] = try await withReviewFallback { level in
            try await sb.client
                .from("promoter_nights")
                .insert(nightPayload)
                .select(Self.nightSelect(level))
                .execute()
                .value
        }

        let allocPayload = nights.map {
            NewAllocation(nightId: $0.id, promoterId: promoterId,
                          spots: spots, payoutPerGuest: payoutPerGuest,
                          groupVisible: groupVisible)
        }
        let allocs: [PromoterAllocation] = try await withReviewFallback { level in
            try await sb.client
                .from("promoter_allocations")
                .insert(allocPayload)
                .select(Self.allocationSelect(level))
                .execute()
                .value
        }

        // Return the earliest by night_date
        return allocs.sorted { ($0.night?.nightDate ?? "") < ($1.night?.nightDate ?? "") }.first
            ?? allocs.first!
    }
}
