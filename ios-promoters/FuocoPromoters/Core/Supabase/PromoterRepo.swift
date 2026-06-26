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

    // MARK: - Series (permanent recurring links)

    private static let webBase = "https://clubfuoco.com"

    struct NewSeries: Encodable {
        let promoterId: UUID
        let clubId: UUID
        let title: String?
        let weekdays: [Int]
        let openTime: String?
        let closeTime: String?
        let spots: Int
        let payoutPerGuest: Decimal
        let groupVisible: Bool
    }

    func createSeries(_ s: NewSeries) async throws -> PromoterSeries {
        try await sb.client
            .from("promoter_series")
            .insert(s)
            .select("""
                id, club_id, title, weekdays, open_time, close_time, spots,
                payout_per_guest, group_visible, invite_token, is_active,
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
                club:clubs ( id, name )
            """)
            .eq("is_active", value: true)
            .order("created_at", ascending: false)
            .execute()
            .value
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
                    club:clubs ( id, name )
                )
            """)
            .eq("id", value: id)
            .single()
            .execute()
            .value
    }

    func barcelonaClubs() async throws -> [Club] {
        try await sb.client
            .from("clubs")
            .select("id,name")
            .ilike("address", pattern: "%Barcelona%")
            .eq("is_active", value: true)
            .order("name", ascending: true)
            .execute()
            .value
    }

    struct NewNight: Encodable {
        let clubId: UUID
        let title: String?
        let nightDate: String   // yyyy-MM-dd
        let openTime: String?   // "HH:mm:ss"
        let closeTime: String?  // "HH:mm:ss"
        let totalCapacity: Int
    }
    struct NewAllocation: Encodable {
        let nightId: UUID
        let promoterId: UUID
        let spots: Int
        let payoutPerGuest: Decimal
        let groupVisible: Bool
    }

    /// Creates one night + self-allocation per date in `dates`.
    /// Returns the first allocation (so the caller can navigate into the
    /// earliest one).
    func createSelfGuestlist(
        clubId: UUID, title: String?, dates: [String],
        openTime: String?, closeTime: String?,
        spots: Int, payoutPerGuest: Decimal,
        groupVisible: Bool, promoterId: UUID
    ) async throws -> PromoterAllocation {
        let nightPayload = dates.map {
            NewNight(clubId: clubId, title: title, nightDate: $0,
                     openTime: openTime, closeTime: closeTime,
                     totalCapacity: max(spots, 50))
        }
        let nights: [PromoterNight] = try await sb.client
            .from("promoter_nights")
            .insert(nightPayload)
            .select("id,club_id,title,night_date,doors_at,open_time,close_time,total_capacity,is_published")
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
