import Foundation

/// Every VIP table is its own product, whoever sells it — one of our
/// promoters through Fuoco checkout, or Fourvenues. The server decides who
/// gets each table's buy button (src/lib/table-products.ts, the portal's
/// Tables page) and sends the decisions with GET /api/partner as `tables`.
///
/// Our own listings arrive already decided (a listing that lost its table
/// isn't in the feed). Fourvenues zones come from a catalog the server
/// doesn't serve, so the app applies the decision to them here: a zone whose
/// table went to one of ours, or to nobody, is taken out of the catalog.
enum TableSellers {
    struct Table: Decodable, Sendable {
        let id: String
        let name: String
        let seller: String
        let offerId: String?
        let fourvenuesZones: [String]
        let fourvenuesOnSale: Bool
    }

    /// club id (lowercased) → zones (normalised) Fourvenues must not sell.
    nonisolated(unsafe) private static var blockedZones: [String: Set<String>] = [:]

    /// True once a server has sent table decisions. An older server sends
    /// none, and then the venue-wide rule in RumbalistOffers.live still holds.
    nonisolated(unsafe) private(set) static var serverDecides = false

    @MainActor
    static func update(_ tables: [String: [Table]]?) {
        guard let tables else { return }   // older server: change nothing
        var blocked: [String: Set<String>] = [:]
        for (club, list) in tables {
            for t in list where !t.fourvenuesOnSale {
                blocked[club.lowercased(), default: []].formUnion(t.fourvenuesZones.map(norm))
            }
        }
        let changed = blocked != blockedZones || !serverDecides
        blockedZones = blocked
        serverDecides = true
        if changed { FVCatalog.shared.tableRulesChanged() }
    }

    /// May Fourvenues sell this zone at this club? Zones in no table always may.
    static func fourvenuesMaySell(clubId: String?, zone: String?) -> Bool {
        guard let clubId, let zone, let blocked = blockedZones[clubId.lowercased()] else { return true }
        return !blocked.contains(norm(zone))
    }

    /// A zone's identity at a club: lowercase, no accents, single spaces.
    /// Must match normZone() in src/lib/table-products.ts.
    static func norm(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }
}
