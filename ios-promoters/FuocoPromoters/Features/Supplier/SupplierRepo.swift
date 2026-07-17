import Foundation

// ── Supplier self-service ────────────────────────────────────────────────────
// A "list" (Rumba, Aashi, …) whose account owns a partner_brand signs in here
// and manages that brand's guestlist offers. Talks to the Bearer-authed
// /api/offers/** routes (the web enforces that every write is scoped to the
// brand this account owns). Mirrors PromoterRepo's URLRequest + { data, error }
// envelope pattern.

struct SupplierBrand: Decodable, Identifiable, Hashable {
    let id: UUID
    let key: String
    let name: String
    let logoUrl: String?
    let color: String
}

struct SupplierOffer: Decodable, Identifiable, Hashable {
    let id: UUID
    let clubId: UUID
    let kind: String            // "free_guestlist" | "vip_table"
    let title: String
    let subtitle: String
    let priceEur: Double?
    let partySize: Int?
    let timeWindow: String
    let validDays: String
    let dressCode: String
    let music: String
    let sortOrder: Int
    let isActive: Bool
    /// Specific dates this offer is NOT running, even though validDays covers
    /// them. Optional so a client on an older API still decodes.
    let skippedDates: [String]?

    var isVip: Bool { kind == "vip_table" }
    func isSkipped(_ date: String) -> Bool { (skippedDates ?? []).contains(date) }
}

struct SupplierClub: Decodable, Identifiable, Hashable {
    let id: UUID
    let name: String
}

/// A change the supplier has submitted that's awaiting Club Fuoco review.
struct SupplierPending: Decodable, Identifiable, Hashable {
    let id: UUID
    let action: String
    let summary: String
}

/// A consumer who booked through this supplier's offers at a venue for a
/// night (rumbalist_purchases + linked booking). checked_in_at stays a raw
/// string — presence is all the UI needs, and it dodges fractional-second
/// ISO date parsing.
struct SupplierGuest: Decodable, Identifiable, Hashable {
    struct Booking: Decodable, Hashable {
        let checkedInAt: String?
        let status: String?
        let partySize: Int?
    }
    let id: UUID
    let fullName: String?
    let productKind: String
    let productName: String?
    let priceEur: Double?
    let booking: Booking?

    var isArrived: Bool { booking?.checkedInAt != nil }
    var partySize: Int { booking?.partySize ?? 1 }
    var displayName: String {
        let n = (fullName ?? "").trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "Guest" : n
    }
}

/// Booking rollup for the Statistics tab (GET /api/offers/stats).
struct OfferStats: Decodable {
    struct Bucket: Decodable, Hashable {
        let bookings: Int
        let people: Int
        let arrived: Int
        let revenue: Double
        static let zero = Bucket(bookings: 0, people: 0, arrived: 0, revenue: 0)
    }
    struct Overview: Decodable {
        let thisMonth: Bucket
        let allTime: Bucket
        let liveOffers: Int
        let venues: Int
    }
    struct OfferLine: Decodable, Identifiable, Hashable {
        let id: UUID
        let title: String
        let clubId: UUID
        let bookings: Int
        let people: Int
        let arrived: Int
        let revenue: Double
    }
    let overview: Overview
    let byOffer: [OfferLine]

    static let empty = OfferStats(
        overview: .init(thisMonth: .zero, allTime: .zero, liveOffers: 0, venues: 0),
        byOffer: [])
}

/// Draft used for create + edit. Nil price ⇒ free guestlist.
struct SupplierOfferDraft {
    var clubId: UUID
    var kind: String
    var title: String
    var subtitle: String
    var priceEur: Double?
    var partySize: Int?
    var timeWindow: String
    var validDays: String
    var dressCode: String
    var music: String
    var sortOrder: Int?
}

enum SupplierError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

@MainActor
final class SupplierRepo {
    private let sb = SupabaseService.shared
    private static let webBase = "https://clubfuoco.com"

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; return d
    }()

    private func token() async throws -> String {
        try await sb.client.auth.session.accessToken
    }

    private func request(_ path: String, method: String, body: [String: Any]? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: "\(Self.webBase)\(path)")!)
        req.httpMethod = method
        req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if !(200...299).contains(code) {
            // Surface the server's { error } message when present.
            if let env = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = env["error"] as? String {
                throw SupplierError.message(msg)
            }
            throw SupplierError.message("Request failed (\(code))")
        }
        return data
    }

    private struct Envelope<T: Decodable>: Decodable { let data: T? }

    private func decode<T: Decodable>(_ data: Data, as: T.Type) throws -> T {
        guard let value = try Self.decoder.decode(Envelope<T>.self, from: data).data else {
            throw SupplierError.message("Empty response")
        }
        return value
    }

    // MARK: - Reads

    /// The brand this account manages, or nil if the account isn't a supplier
    /// (the route replies 403 — treated as "not a supplier", not an error).
    func me() async throws -> SupplierBrand? {
        struct MeEnv: Decodable { let brand: SupplierBrand? }
        do {
            let data = try await request("/api/offers/me", method: "GET")
            return try decode(data, as: MeEnv.self).brand
        } catch SupplierError.message(let m) where m.contains("No brand") || m.contains("Unauthorized") {
            return nil
        }
    }

    func offers() async throws -> [SupplierOffer] {
        try decode(try await request("/api/offers", method: "GET"), as: [SupplierOffer].self)
    }

    /// Update the caller's public brand identity (name / logo). No-op fields
    /// are omitted. Only meaningful when the account owns a brand.
    func updateBrand(name: String?, logoURL: String?) async throws {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let logoURL { body["logo_url"] = logoURL }
        guard !body.isEmpty else { return }
        _ = try await request("/api/offers/me", method: "PATCH", body: body)
    }

    func clubs() async throws -> [SupplierClub] {
        try decode(try await request("/api/offers/clubs", method: "GET"), as: [SupplierClub].self)
    }

    /// Changes this supplier has submitted that are awaiting review.
    func pending() async throws -> [SupplierPending] {
        try decode(try await request("/api/offers/pending", method: "GET"), as: [SupplierPending].self)
    }

    /// Turn one night of an offer off (or back on). Scheduling, not content —
    /// applies immediately rather than going through the review queue.
    @discardableResult
    func setNight(offerId: UUID, date: String, skipped: Bool) async throws -> Bool {
        _ = try await request("/api/offers/\(offerId.uuidString.lowercased())/nights",
                              method: "PATCH", body: ["date": date, "skipped": skipped])
        return true
    }

    /// Booking rollup across all the caller's public offers.
    func stats() async throws -> OfferStats {
        try decode(try await request("/api/offers/stats", method: "GET"), as: OfferStats.self)
    }

    /// Who booked through this supplier's offers at a venue on a given night.
    func guests(clubId: UUID, date: String) async throws -> [SupplierGuest] {
        try decode(try await request(
            "/api/offers/guests?club_id=\(clubId.uuidString.lowercased())&date=\(date)",
            method: "GET"), as: [SupplierGuest].self)
    }

    // MARK: - Writes
    // Each returns whether the change was queued for review (true) vs applied
    // live (false — the pre-approval fallback before the queue is enabled).

    @discardableResult
    func create(_ d: SupplierOfferDraft) async throws -> Bool {
        decodePending(try await request("/api/offers", method: "POST", body: Self.body(from: d, includeClub: true)))
    }

    @discardableResult
    func update(id: UUID, _ d: SupplierOfferDraft) async throws -> Bool {
        decodePending(try await request("/api/offers/\(id.uuidString.lowercased())", method: "PATCH",
                              body: Self.body(from: d, includeClub: false)))
    }

    @discardableResult
    func setActive(id: UUID, active: Bool) async throws -> Bool {
        decodePending(try await request("/api/offers/\(id.uuidString.lowercased())", method: "PATCH",
                              body: ["is_active": active]))
    }

    @discardableResult
    func delete(id: UUID) async throws -> Bool {
        decodePending(try await request("/api/offers/\(id.uuidString.lowercased())", method: "DELETE"))
    }

    private func decodePending(_ data: Data) -> Bool {
        struct Env: Decodable { let data: Payload? }
        struct Payload: Decodable { let pending: Bool? }
        return (try? Self.decoder.decode(Env.self, from: data))?.data?.pending ?? false
    }

    /// Build the JSON body. price_eur / party_size are sent as explicit null
    /// (not omitted) because the server schema requires them present.
    private static func body(from d: SupplierOfferDraft, includeClub: Bool) -> [String: Any] {
        var b: [String: Any] = [
            "kind":        d.kind,
            "title":       d.title,
            "subtitle":    d.subtitle,
            "price_eur":   d.priceEur.map { $0 as Any } ?? NSNull(),
            "party_size":  d.partySize.map { $0 as Any } ?? NSNull(),
            "time_window": d.timeWindow,
            "valid_days":  d.validDays,
            "dress_code":  d.dressCode,
            "music":       d.music,
        ]
        if includeClub { b["club_id"] = d.clubId.uuidString.lowercased() }
        if let s = d.sortOrder { b["sort_order"] = s }
        return b
    }
}
