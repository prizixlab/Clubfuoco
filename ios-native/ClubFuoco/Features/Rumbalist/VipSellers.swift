import Foundation

/// VIP tables are products: the tables saved from Fourvenues, one per named
/// zone at a club. Promoters SELL them, in the order Club Fuoco ranks them,
/// and on each night the highest-ranked promoter who is selling holds the buy
/// button (src/lib/vip-products.ts). The server sends that decision with
/// GET /api/partner?tables=1 as `vipSellers`: club → night → zone → seller.
///
/// The app applies it to the Fourvenues catalog (FVCatalog.events):
///   • a Fourvenues seller (HypeList's set-up) — only that promoter's own
///     listing of the table shows, checking out on Fourvenues as always;
///   • a Fuoco seller — one listing of the table shows, marked `soldBy`, and
///     FVEventSheet checks it out with Fuoco (Apple Pay), deposit or full.
/// No entry for a table → shown as the catalog has it (older server, or the
/// server couldn't read the catalog).
enum VipSellers {
    struct Seller: Decodable, Hashable, Sendable {
        let brandKey: String
        let brandName: String
        let brandColor: String?
        /// "fourvenues" | "fuoco"
        let checkout: String
        /// What the guest may pay now on Fuoco checkout: "both" | "deposit" | "full".
        let payment: String

        var isFuoco: Bool { checkout == "fuoco" }

        var brand: PartnerBrand {
            PartnerBrand(key: brandKey, name: brandName, logoURL: nil,
                         color: brandColor ?? "#C09950",
                         attributionRequired: false, attributionLabel: nil)
        }
    }

    /// club (lowercased) → night → normalised zone → seller.
    nonisolated(unsafe) private static var map: [String: [String: [String: Seller]]] = [:]
    nonisolated(unsafe) private(set) static var serverDecides = false

    @MainActor
    static func update(_ sellers: [String: [String: [String: Seller]]]?) {
        guard let sellers else { return }   // older server: change nothing
        var next: [String: [String: [String: Seller]]] = [:]
        for (club, nights) in sellers {
            next[club.lowercased()] = nights.mapValues { zones in
                Dictionary(zones.map { (norm($0.key), $0.value) }, uniquingKeysWith: { a, _ in a })
            }
        }
        let changed = next != map || !serverDecides
        map = next
        serverDecides = true
        if changed { FVCatalog.shared.tableRulesChanged() }
    }

    static func seller(clubId: String?, night: String, zone: String?) -> Seller? {
        guard let clubId, let zone else { return nil }
        return map[clubId.lowercased()]?[night]?[norm(zone)]
    }

    /// A zone's identity at a club: lowercase, no accents, single spaces.
    /// Must match normZone() in src/lib/vip-products.ts.
    static func norm(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    // ── Fuoco checkout price (mirrors payModes/chargeFor server-side) ───────

    enum Pay: String { case deposit, full }

    /// What the guest may pay now for this rate under the promoter's limit.
    static func modes(_ rate: FVRate, limit: String) -> [Pay] {
        var m: [Pay] = []
        if let d = rate.depositAmount, d < rate.price { m.append(.deposit) }
        m.append(.full)
        if limit == "deposit", m.contains(.deposit) { return [.deposit] }
        if limit == "full" { return [.full] }
        return m
    }

    static func amount(_ rate: FVRate, _ pay: Pay) -> Double {
        pay == .deposit ? (rate.depositAmount ?? rate.price) : rate.price
    }
}
