import Foundation

/// Rumbalist booking offers, keyed by clubs.id — native port of
/// src/lib/rumbalist-offers.ts. Sourced from our Rumbalist partnership; the
/// venue detail page shows the offers for the matching club.
struct RumbalistOffer: Identifiable, Hashable {
    enum Kind { case freeGuestlist, vipTable }

    let id = UUID()
    let kind: Kind
    let title: String          // "Free Guestlist" / "VIP Table"
    let subtitle: String       // e.g. "Free till 1:00 AM"
    let priceEur: Double?      // nil = free
    let partySize: Int?
    let timeWindow: String
    let validDays: String
    let dressCode: String
    let music: String
    /// The supplier behind THIS offer. Offers come from many brands (any
    /// promoter can publish one), so the booking flow brands itself per offer
    /// rather than from a single app-wide supplier. nil = bundled fallback
    /// data, or an offer whose brand didn't resolve — show no credit.
    var brand: PartnerBrand? = nil
    /// Nights the supplier turned off, even though validDays covers them
    /// ("normally Monday, but not Monday the 20th").
    var skippedDates: [String] = []

    var isVip: Bool { kind == .vipTable }
    /// Is this offer actually running on `date` ("yyyy-MM-dd")?
    /// Only checks the skipped-dates exceptions — see `liveOn(_:)` for the
    /// full liveness predicate that also enforces `validDays`.
    func runsOn(_ date: String) -> Bool { !skippedDates.contains(date) }

    /// The shared liveness predicate (spec 1.3): live on `date` when the
    /// offer's valid days cover that weekday AND the supplier hasn't skipped
    /// that specific night. (is_active is implicit — /api/partner only returns
    /// live offers.) CLIENT-SIDE ONLY: booking enforcement stays server-side
    /// in offerRunsOn() (src/lib/partner.ts).
    func liveOn(_ date: String) -> Bool {
        guard let weekday = Self.weekdayIndex(of: date) else { return false }
        return ValidDays.parse(validDays).contains(weekday) && runsOn(date)
    }

    /// Weekday (0=Sun…6=Sat) of a "yyyy-MM-dd" calendar date via Sakamoto's
    /// algorithm — pure integer arithmetic, so no timezone can shift the day.
    /// Matches weekdayOf() in the web's src/lib/valid-days.ts exactly.
    static func weekdayIndex(of date: String) -> Int? {
        let parts = date.split(separator: "-")
        guard parts.count == 3,
              var y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), (1...31).contains(d)
        else { return nil }
        let t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
        if m < 3 { y -= 1 }
        return (y + y / 4 - y / 100 + y / 400 + t[m - 1] + d) % 7
    }
}

/// The active offer supplier's identity from GET /api/partner. Suppliers are
/// offer providers, not the face of the app — Club Fuoco stays the brand.
/// When `attributionRequired` (a contract clause, set per supplier in the
/// Partner Portal), the booking sheet shows a small subordinate credit:
/// "\(attributionLabel) \(name)", e.g. "Guestlist by Rumba".
struct PartnerBrand: Hashable, Sendable {
    let key: String
    let name: String
    let logoURL: URL?
    let color: String
    let attributionRequired: Bool
    let attributionLabel: String?
}

enum RumbalistOffers {
    private static func free(_ subtitle: String, _ music: String, _ dress: String,
                             days: String = "Sun – Fri",
                             time: String = "Door open till closing") -> RumbalistOffer {
        RumbalistOffer(kind: .freeGuestlist, title: "Free Guestlist", subtitle: subtitle,
                       priceEur: nil, partySize: nil, timeWindow: time,
                       validDays: days, dressCode: dress, music: music)
    }

    private static func vip(_ price: Double, _ music: String,
                            days: String = "Any night", size: Int = 5) -> RumbalistOffer {
        RumbalistOffer(kind: .vipTable, title: "VIP Table",
                       subtitle: "From €\(Int(price)) · \(size) people · Fully consumable on bottles",
                       priceEur: price, partySize: size, timeWindow: "Reservation for the night",
                       validDays: days, dressCode: "Smart casual", music: music)
    }

    /// clubs.id (lowercased) → offers.
    /// Bundled fallback so offers render instantly / offline on first launch.
    /// Replaced at runtime by `refresh(api:)` with the live set from the backend.
    static let bundledByClub: [String: [RumbalistOffer]] = [
        // Opium Barcelona
        "b3f7747f-d911-490d-a688-d04add6a1c8b": [
            free("Free till 1:00 AM", "R&B · Hip Hop · Commercial House · Reggaeton", "Elegant — no sneakers or sportswear", days: "Every night"),
            vip(300, "Reggaeton · Commercial · Hits · Pop", days: "Every night"),
        ],
        // Pacha Barcelona
        "d184f2f1-8db3-4d03-ae11-ad19b650894d": [
            free("Free till 02:30 AM", "Reggaeton · Hip Hop · Top Hits · Techno · House", "Smart casual — no sportswear", days: "Every night"),
            vip(300, "Reggaeton · Hip Hop · Top Hits · R&B · Techno · House · Electronic", days: "Every night"),
        ],
        // Jamboree
        "a83428e5-5c7f-4f55-99e5-3f329f7c3210": [
            free("Free till 2:00 AM", "Hip Hop · R&B · Dancehall", "Casual — no sneakers or sportswear", days: "Mon, Tue, Wed, Sun"),
        ],
        // Disco City Hall
        "bdafd62c-2543-4238-9951-e4a1a17bb7eb": [
            free("Free entry + free bar till 01:00 AM", "Reggaeton · Hip Hop · Top Hits · R&B · Techno · House · Electronic", "Casual"),
        ],
        // Twenties Barcelona
        "3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb": [
            free("Free till 1:00 AM", "Reggaeton · Top Hits · House", "Casual — no sportswear or sneakers", days: "Tue, Thu – Sun"),
            vip(300, "Hits · Reggaeton · R&B · Commercial House · Top Hits", days: "Tue, Thu – Sun"),
        ],
        // Shôko
        "ddca5d10-9b4f-47c4-81a2-2c36bef77e49": [
            free("Free till 01:00 AM", "Hip Hop · R&B · Reggaeton · Electro · Commercial House · EDM", "Casual — no sneakers or sportswear", days: "Tue, Wed, Sun"),
            vip(300, "Hip Hop · R&B · Reggaeton · Electro · Commercial House · EDM", days: "Tue, Wed, Sun"),
        ],
        // CDLC (Carpe Diem)
        "d649395c-d3db-4397-b200-42b575d1738a": [
            free("Free till 1:00 AM", "Top Hits · Reggaeton", "Casual elegant — no sportswear", days: "Tue, Wed, Sun"),
            vip(400, "Deep House · Tech House · Hip Hop · R&B · Pop", days: "Tue, Wed, Sun"),
        ],
        // Bling Bling
        "07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2": [
            vip(250, "Reggaeton · Commercial House · R&B · Top Hits", days: "Wed"),
        ],
        // Downtown Barcelona
        "60d6f94e-26cc-4d24-bacc-8a255e1c7924": [
            vip(300, "Reggaeton · R&B · Top Hits", days: "Thu, Fri"),
        ],
        // Sutton Club
        "e0cf6310-28e5-4117-ad5f-01179f87d8fd": [
            vip(300, "Reggaeton · House · Top Hits", days: "Thu – Sat"),
        ],
    ]

    /// Live offer catalog, keyed by lowercased club id. Seeded from the bundle,
    /// swapped in by `refresh(api:)` (written on the main actor at launch and
    /// on each app-foreground).
    nonisolated(unsafe) private(set) static var byClub: [String: [RumbalistOffer]] = bundledByClub

    /// The primary/featured supplier, kept only for surfaces that still want an
    /// app-wide brand. Per-offer attribution lives on `RumbalistOffer.brand` —
    /// prefer that. nil until the first successful refresh.
    nonisolated(unsafe) private(set) static var brand: PartnerBrand?

    /// Lowercased club ids with at least one LIVE offer, from the last
    /// successful fetch — overwritten even when the answer is "none" (unlike
    /// `byClub`, which keeps the bundle as an offline seed for the detail
    /// sheets). nil until the first successful fetch. This is the membership
    /// signal for deal-derived cosmetics like RumbaScore.
    nonisolated(unsafe) private(set) static var liveClubIds: Set<String>?

    /// Does this club have a live offer? Falls back to the bundled catalog
    /// only before the first successful fetch (mirrors the web's
    /// PartnerContext seeding).
    static func hasLiveOffer(_ clubId: String) -> Bool {
        if let liveClubIds { return liveClubIds.contains(clubId.lowercased()) }
        return !offers(for: clubId).isEmpty
    }

    static func offers(for clubId: String) -> [RumbalistOffer] {
        byClub[clubId.lowercased()] ?? []
    }

    // ── Backend feed ────────────────────────────────────────────────────────
    // The active partner's offers from GET /api/partner. Keeps the catalog
    // editable (and swappable) without an app release; falls back to the bundle.

    private struct Response: Decodable, Sendable {
        let brand: BrandDTO?          // primary supplier (legacy field)
        let offersByClub: [String: [OfferDTO]]
    }
    private struct BrandDTO: Decodable, Sendable {
        let key: String
        let name: String
        let logoUrl: String?
        let color: String
        // Optional: an API deploy that predates the attribution migration
        // doesn't send these — default to "no credit required".
        let attributionRequired: Bool?
        let attributionLabel: String?

        var model: PartnerBrand {
            PartnerBrand(
                key: key, name: name,
                logoURL: logoUrl.flatMap(URL.init(string:)),
                color: color,
                attributionRequired: attributionRequired ?? false,
                attributionLabel: attributionLabel)
        }
    }
    private struct OfferDTO: Decodable, Sendable {
        let kind: String
        let title: String
        let subtitle: String
        let priceEur: Double?
        let partySize: Int?
        let timeWindow: String
        let validDays: String
        let dressCode: String
        let music: String
        // Which supplier this offer belongs to. Optional so an API deploy that
        // predates per-offer attribution still decodes.
        let brand: BrandDTO?
        // Optional for the same reason — an older API sends no exceptions.
        let skippedDates: [String]?

        var model: RumbalistOffer {
            RumbalistOffer(
                kind: kind == "vip_table" ? .vipTable : .freeGuestlist,
                title: title, subtitle: subtitle, priceEur: priceEur, partySize: partySize,
                timeWindow: timeWindow, validDays: validDays, dressCode: dressCode, music: music,
                brand: brand?.model, skippedDates: skippedDates ?? [])
        }
    }

    @MainActor
    static func refresh(api: APIClient) async {
        _ = await fetchLive(api: api)
    }

    /// One fetch of the live offer set, keyed by lowercased club id. Returns
    /// nil on a FAILED request (network/decode) so callers that rank venues
    /// can degrade to no-deal-signal; an empty map is a real answer ("nothing
    /// is live"). Also refreshes the shared catalog so the detail sheets and
    /// RumbaScore see the same set — the bundle stays as an offline fallback
    /// there, but ranking must never key off it.
    @MainActor
    static func fetchLive(api: APIClient) async -> [String: [RumbalistOffer]]? {
        guard let resp: Response = try? await api.get("/api/partner") else { return nil }
        brand = resp.brand?.model
        let mapped = resp.offersByClub.reduce(into: [String: [RumbalistOffer]]()) { acc, pair in
            acc[pair.key.lowercased()] = pair.value.map(\.model)
        }
        // Keep the bundle for the DETAIL surfaces when the backend is empty
        // (their offline seed), but still report the truthful empty set.
        if !mapped.isEmpty { byClub = mapped }
        liveClubIds = Set(mapped.keys)
        return mapped
    }
}
