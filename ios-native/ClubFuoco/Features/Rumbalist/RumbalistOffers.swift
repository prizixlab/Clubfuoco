import Foundation

/// Rumbalist booking offers, keyed by clubs.id — native port of
/// src/lib/rumbalist-offers.ts. Demo data scraped from rumbalist.com; the
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

    var isVip: Bool { kind == .vipTable }
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
    static let byClub: [String: [RumbalistOffer]] = [
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

    static func offers(for clubId: String) -> [RumbalistOffer] {
        byClub[clubId.lowercased()] ?? []
    }
}
