import Foundation

/// One priced wave of tickets on a night.
///
/// A release ends on WHICHEVER COMES FIRST — its cut-off passing, or its
/// allocation selling out. That is what a promoter means by "early bird, 100
/// tickets, until Friday", and it is the rule the server applies (see
/// public.active_release and lib/releases.ts). Nothing here re-decides it;
/// this type only has to describe one wave and keep the order.
struct TicketRelease: Identifiable, Hashable, Codable {
    /// Nil until the row exists on the server — a wave being typed has no id.
    var id: UUID?
    /// Sale order, 1 first. NOT a date sort: two waves can share a cut-off and
    /// the promoter's stated order is what decides which sells first.
    var position: Int
    var name: String
    var priceCents: Int
    /// When it stops selling. Nil = runs until the night itself, which is what
    /// the last wave almost always wants.
    var endsAt: Date?
    /// Tickets this wave may sell, in HEADS (a guest plus their plus-ones),
    /// matching how capacity is counted everywhere else. Nil = no limit.
    var quantity: Int?

    /// Heads already taken. Server-supplied and read-only here: it counts real
    /// rows, so it is never something the editor can set.
    var sold: Int = 0

    var priceText: String {
        priceCents % 100 == 0
            ? "€\(priceCents / 100)"
            : String(format: "€%.2f", Double(priceCents) / 100)
    }

    static func blank(position: Int) -> TicketRelease {
        TicketRelease(id: nil, position: position, name: "", priceCents: 0, endsAt: nil, quantity: nil)
    }
}

/// What the editor sends. `night_id` is filled in per night at save time — one
/// ladder can apply to several dates created in the same go.
struct NewRelease: Encodable {
    let nightId: UUID
    let position: Int
    let name: String?
    let priceCents: Int
    let endsAt: Date?
    let quantity: Int?

    enum CodingKeys: String, CodingKey {
        case nightId = "night_id"
        case position
        case name
        case priceCents = "price_cents"
        case endsAt = "ends_at"
        case quantity
    }
}

/// A row as it comes back from PostgREST.
struct ReleaseRow: Decodable {
    let id: UUID
    let position: Int
    let name: String?
    let priceCents: Int
    let endsAt: Date?
    let quantity: Int?

    enum CodingKeys: String, CodingKey {
        case id, position, name, quantity
        case priceCents = "price_cents"
        case endsAt = "ends_at"
    }

    func toRelease() -> TicketRelease {
        TicketRelease(id: id, position: position, name: name ?? "",
                      priceCents: priceCents, endsAt: endsAt, quantity: quantity)
    }
}

enum ReleaseRules {
    /// The hard ceiling, matching the DB's `position between 1 and 20`.
    static let maxReleases = 20

    /// What is wrong with this ladder, in the promoter's words — or nil.
    ///
    /// Checked here as well as in the database because a round trip that comes
    /// back "violates check constraint" is not something a promoter can act on.
    static func problem(with releases: [TicketRelease], nightPriceCents: Int) -> String? {
        guard !releases.isEmpty else { return nil }
        if releases.count > maxReleases { return "A night can have at most \(maxReleases) releases." }

        for (i, r) in releases.enumerated() {
            let n = i + 1
            if r.priceCents <= 0 {
                return "Release \(n) needs a price. Use one release, or none, for a single flat price."
            }
            if let q = r.quantity, q <= 0 {
                return "Release \(n)'s ticket limit has to be at least 1, or unlimited."
            }
        }

        // Cut-offs must climb. A wave that closes before the one above it can
        // never sell — the earlier wave is still live when it expires.
        var last: Date?
        for (i, r) in releases.enumerated() {
            guard let ends = r.endsAt else { continue }
            if let prev = last, ends <= prev {
                return "Release \(i + 1) closes before the one above it, so it would never go on sale."
            }
            last = ends
        }

        // Only the LAST wave may run open-ended: an earlier one with no cut-off
        // and no limit never hands over.
        for (i, r) in releases.enumerated() where i < releases.count - 1 {
            if r.endsAt == nil && r.quantity == nil {
                return "Release \(i + 1) has no end date and no ticket limit, so nothing after it would ever sell."
            }
        }
        return nil
    }
}
