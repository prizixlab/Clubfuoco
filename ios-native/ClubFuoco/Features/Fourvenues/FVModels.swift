import Foundation

// ── Fourvenues offers ────────────────────────────────────────────────────────
//
// What the agentbox mapper (scripts/agentbox/fourvenues_map.py) writes, one
// event per night on our `clubfuoco-hype` channel. PROTOTYPE: the app reads a
// bundled snapshot (FourvenuesSample.json); the real feed will come from
// Supabase once the external_products migration lands.
//
// Sorted by what the guest PAYS, never by what Fourvenues calls a product —
// see `Settle`.

struct FVFeed: Decodable {
    let channel: String
    let events: [FVEvent]
}

struct FVEvent: Decodable, Identifiable, Hashable {
    let code: String
    let name: String?
    let venue: String?
    /// Our clubs.id for the venue, when the mapper knows it.
    let clubId: String?
    let address: String?
    /// yyyy-MM-dd, the NIGHT (a 00:30 start belongs to the evening before).
    let night: String
    let startsAt: String
    let doors: String?
    let closes: String?
    let minAge: Int?
    let genres: [String]
    let image: String?
    let url: String
    let products: [FVProduct]
    /// How the night's VIP areas fit together, for the overview map.
    let vipMap: FVVipMap?

    var id: String { code }

    enum CodingKeys: String, CodingKey {
        case code, name, venue, address, night, doors, closes, genres, image, url, products
        case vipMap = "vip_map"
        case startsAt = "starts_at"
        case minAge = "min_age"
        case clubId = "club_id"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        venue = try c.decodeIfPresent(String.self, forKey: .venue)
        clubId = try c.decodeIfPresent(String.self, forKey: .clubId)
        address = try c.decodeIfPresent(String.self, forKey: .address)
        night = try c.decode(String.self, forKey: .night)
        startsAt = try c.decode(String.self, forKey: .startsAt)
        doors = try c.decodeIfPresent(String.self, forKey: .doors)
        closes = try c.decodeIfPresent(String.self, forKey: .closes)
        minAge = try c.decodeIfPresent(Int.self, forKey: .minAge)
        genres = try c.decode([String].self, forKey: .genres)
        image = try c.decodeIfPresent(String.self, forKey: .image)
        url = try c.decode(String.self, forKey: .url)
        products = FVOffer.curate(try c.decode([FVProduct].self, forKey: .products))
        vipMap = try c.decodeIfPresent(FVVipMap.self, forKey: .vipMap)
    }
}

/// Which of a night's products we sell. One rule for every venue:
/// - a free guestlist beats paid entry that includes nothing extra;
/// - among paid entry, an option is dropped when another costs the same or
///   less and includes at least as much (drinks, shots, bottle, open bar);
/// - sold-out options are kept only while nothing else in their tier is on sale,
///   so a fully sold-out tier still reads "sold out" instead of vanishing.
/// Guestlists and tables are left alone.
enum FVOffer {
    static func curate(_ all: [FVProduct]) -> [FVProduct] {
        let paid: Set<Settle> = [.online, .door]
        let onSale = all.filter { !$0.soldOut }
        let freeTonight = onSale.contains { $0.settle == .free }
        var keep = onSale.filter { p in
            guard paid.contains(p.settle) else { return true }
            return !(freeTonight && !p.perks.includesSomething)
        }
        keep = keep.filter { p in
            guard paid.contains(p.settle) else { return true }
            return !keep.contains { q in
                q.id != p.id && paid.contains(q.settle) && q.price <= p.price && q.perks.covers(p.perks)
                    // Equal in price and perks: the first listed stays.
                    && (q.price < p.price || !p.perks.covers(q.perks)
                        || all.firstIndex(of: q)! < all.firstIndex(of: p)!)
            }
        }
        // A tier with nothing on sale keeps its sold-out products.
        for tier in FVTier.allCases where !keep.contains(where: tier.includes) {
            if tier == .paid && freeTonight { continue }
            keep += all.filter { tier.includes($0) && $0.soldOut }
        }
        return all.filter { keep.contains($0) }
    }
}

/// How money changes hands for a product. This — not Fourvenues' own list a
/// product came from — decides the label, the flow and the ticket card.
enum Settle: String, Decodable {
    /// Nothing to pay anywhere. Always shown as "Guestlist", whether Fourvenues
    /// filed it as a guestlist or as a €0 ticket.
    case free
    /// Sign up now, pay at the venue. Must be impossible to miss.
    case door
    /// Pay now, through Fourvenues' checkout (Apple Pay, card, Bizum).
    case online
    /// A table zone; each rate carries its own price.
    case table
}

struct FVProduct: Decodable, Identifiable, Hashable {
    let id: String
    /// Which Fourvenues list it came from. Only used to build the URL.
    let source: String
    let name: String?
    let detail: String?
    let price: Double
    let settle: Settle
    let min: Int?
    let max: Int?
    let soldOut: Bool
    let fewLeft: Bool?
    let minAge: Int?
    let checkout: String
    let rates: [FVRate]?
    let zonePage: String?
    /// {"en": …, "es": …} — see FVLang. Missing until agentbox has them.
    let nameI18n: [String: String]?
    let detailI18n: [String: String]?
    /// Guestlists: when entry is allowed ("from" / "until", "HH:mm").
    let window: FVWindow?
    /// Tables: the zone's floor plan, when the venue publishes one.
    let map: FVZoneMap?

    /// What the price includes, read from the name and the description.
    var perks: FVPerks { FVPerks([name, detail].compactMap { $0 }.joined(separator: " · ")) }

    enum CodingKeys: String, CodingKey {
        case id, source, name, detail, price, settle, min, max, checkout, rates, window, map
        case nameI18n = "name_i18n"
        case detailI18n = "detail_i18n"
        case soldOut = "sold_out"
        case fewLeft = "few_left"
        case minAge = "min_age"
        case zonePage = "zone_page"
    }

    func title(_ locale: String) -> String? { FVLang.pick(nameI18n, name, locale) }
    func info(_ locale: String) -> String? { FVLang.pick(detailI18n, detail, locale) }

    /// Anything that runs without the guest paying online can be done in the
    /// background: free entry and pay-at-the-door lists.
    var signsUpInBackground: Bool { settle == .free || settle == .door }

    var maxPerOrder: Int { Swift.max(1, Swift.min(max ?? 10, 10)) }

    func checkoutURL(quantity: Int) -> URL? {
        URL(string: checkout.replacingOccurrences(of: "{qty}", with: "\(quantity)"))
    }

    func tableURL(rate: FVRate, pax: Int) -> URL? {
        URL(string: checkout
            .replacingOccurrences(of: "{pax}", with: "\(pax)")
            .replacingOccurrences(of: "{rate}", with: rate.id))
    }
}

struct FVRate: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let price: Double
    /// Group sizes this table takes, exactly as Fourvenues offers them — not
    /// always a range (a lounge can be 1–12 then 15–18; a pool bed 4, 5 or 6).
    /// Nil until agentbox has read the zone page.
    let pax: [Int]?
    let deposit: Double?
    /// "porcentaje" (a % of the total) or "por_reserva" (a fixed amount).
    let depositType: String?
    let description: String?
    /// The venue lets the guest pay the whole table now instead of the deposit.
    let fullPayment: Bool?
    let nameI18n: [String: String]?
    let descriptionI18n: [String: String]?

    enum CodingKeys: String, CodingKey {
        case id, name, price, pax, deposit, description
        case depositType = "deposit_type"
        case fullPayment = "full_payment"
        case nameI18n = "name_i18n"
        case descriptionI18n = "description_i18n"
    }

    func title(_ locale: String) -> String? { FVLang.pick(nameI18n, name, locale) }
    func info(_ locale: String) -> String? { FVLang.pick(descriptionI18n, description, locale) }

    /// What the deposit comes to in euros.
    var depositAmount: Double? {
        guard let deposit, deposit > 0 else { return nil }
        return depositType == "porcentaje" ? price * deposit / 100 : deposit
    }

    /// Deposit now or the whole table now — only when the venue offers both.
    var offersFullPayment: Bool {
        guard fullPayment == true, let d = depositAmount else { return false }
        return d < price
    }

    /// The sizes the stepper walks through.
    var sizes: [Int] {
        let s = (pax ?? []).filter { $0 > 0 }.sorted()
        return s.isEmpty ? Array(1...10) : s
    }

    /// "50%" or "€50", for the details card.
    var depositLabel: String? {
        guard let deposit, deposit > 0 else { return nil }
        return depositType == "porcentaje" ? "\(Int(deposit))%" : deposit.euros
    }
}

extension Double {
    /// "€15", "€12.50".
    var euros: String {
        truncatingRemainder(dividingBy: 1) == 0
            ? "€\(Int(self))"
            : "€" + String(format: "%.2f", self)
    }
}

/// The HypeList/Fourvenues offers, pulled hourly from Supabase Storage.
///
/// agentbox reads the channel every hour and publishes
/// `storage/v1/object/public/fourvenues/offers.json` (fourvenues_push.py).
/// The app keeps the last good copy on disk, and falls back to the snapshot
/// bundled at build time, so a club page is never empty just because the
/// phone is offline.
@MainActor @Observable
final class FVCatalog {
    static let shared = FVCatalog()

    private(set) var events: [FVEvent] = [] {
        didSet { RumbalistOffers.fourvenuesByClub = Self.guestlistOffers(events) }
    }
    private(set) var fetchedAt: Date?

    /// HypeList, as it appears in partner_brands — credited on its offers.
    static let brand = PartnerBrand(
        key: "hypelist", name: "HypeList",
        logoURL: URL(string: "https://nqviodkapzjdkbgknauo.supabase.co/storage/v1/object/public/brand/hypelist/logo.png"),
        color: "#814AC8", attributionRequired: false, attributionLabel: nil)

    /// Every FREE product on a club night becomes a Free Guestlist offer for
    /// that club and that night. Pay-at-the-door and paid products are not free
    /// and stay out of the Guestlist button.
    static func guestlistOffers(_ events: [FVEvent]) -> [String: [RumbalistOffer]] {
        // ONE Guestlist per club per night. A club running two rooms (Otto
        // Zutz's main room + Sala 2, Ku + Red Room) has a free list on each,
        // and two identical "Free Guestlist" cards read as a duplicate. The
        // card covers the night; the sheet lets the guest pick the room.
        var nights: [String: [(FVEvent, FVProduct)]] = [:]
        for e in events {
            guard let club = e.clubId?.lowercased(),
                  let free = e.products.first(where: { $0.settle == .free && !$0.soldOut })
                    ?? e.products.first(where: { $0.settle == .free })
            else { continue }
            nights[club + "|" + e.night, default: []].append((e, free))
        }
        var out: [String: [RumbalistOffer]] = [:]
        for (key, list) in nights {
            let club = String(key.split(separator: "|")[0])
            let rooms = list.sorted { $0.0.startsAt < $1.0.startsAt }
            let (e, p) = rooms.first { !$0.1.soldOut } ?? rooms[0]
            let till = (p.window?.until ?? FVText.freeWindow([p.name, p.detail])).map { "free till \($0)" }
                ?? e.doors.map { "doors \($0)" }
            let name = [FVText.pretty(e.name), rooms.count > 1 ? "+ \(rooms.count - 1) more" : nil]
                .compactMap { $0 }.joined(separator: " ")
            var offer = RumbalistOffer(
                kind: .freeGuestlist,
                title: "Free Guestlist",
                subtitle: [name, till].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                priceEur: nil, partySize: nil,
                timeWindow: p.detail ?? p.name ?? "",
                validDays: e.night,
                dressCode: e.minAge.map { "\($0)+" } ?? "",
                music: e.genres.joined(separator: " · "),
                brand: brand)
            // Stable across rebuilds of the same feed (club + night).
            offer.id = UUID(fvSeed: key)
            offer.fourvenues = FVOfferRef(event: e, product: p, rooms: rooms.map(\.0))
            out[club, default: []].append(offer)
        }
        return out
    }

    static let remote = SupabaseService.supabaseURL
        .appending(path: "storage/v1/object/public/fourvenues/offers.json")
    private static let maxAge: TimeInterval = 3600

    private let cacheFile: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("fourvenues-offers.json")
    }()
    private var inFlight = false

    private init() {
        if let data = try? Data(contentsOf: cacheFile), let feed = Self.decode(data) {
            events = feed.events
            fetchedAt = (try? cacheFile.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate
        } else if let url = Bundle.main.url(forResource: "FourvenuesSample", withExtension: "json"),
                  let data = try? Data(contentsOf: url), let feed = Self.decode(data) {
            events = feed.events
        }
        // didSet doesn't run during init — publish the offers explicitly.
        RumbalistOffers.fourvenuesByClub = Self.guestlistOffers(events)
    }

    /// Download if the copy we hold is over an hour old (or `force`).
    func refresh(force: Bool = false) async {
        if inFlight { return }
        if !force, let fetchedAt, Date().timeIntervalSince(fetchedAt) < Self.maxAge { return }
        inFlight = true
        defer { inFlight = false }
        var req = URLRequest(url: Self.remote)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let feed = Self.decode(data), !feed.events.isEmpty
        else { return }   // keep what we have
        events = feed.events
        fetchedAt = Date()
        try? data.write(to: cacheFile, options: .atomic)
    }

    /// Checks every 15 minutes while the app is open; refresh() only downloads
    /// when the copy is an hour old, so this is an hourly pull in practice.
    func keepFresh() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(15 * 60))
        }
    }

    /// Upcoming nights at one of our clubs, soonest first.
    func upcoming(clubId: String) -> [FVEvent] {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        let today = f.string(from: Date().addingTimeInterval(-6 * 3600))
        return events.filter { $0.clubId?.lowercased() == clubId.lowercased() && $0.night >= today }
    }

    private static func decode(_ data: Data) -> FVFeed? {
        do {
            return try JSONDecoder().decode(FVFeed.self, from: data)
        } catch {
            // Say why — a silent failure here leaves the app on a stale feed.
            FVTrace.log("feed decode failed: \(error)")
            return nil
        }
    }
}

/// The Fourvenues night + product behind a guestlist offer, and every room
/// with a free list that night (one card covers them all).
struct FVOfferRef: Hashable {
    let event: FVEvent
    let product: FVProduct
    var rooms: [FVEvent] = []
    /// Live while any room's free list still has space.
    var soldOut: Bool { (rooms.isEmpty ? [event] : rooms).allSatisfy { r in
        !r.products.contains { $0.settle == .free && !$0.soldOut } } }
}

extension UUID {
    /// A deterministic UUID from a string (FNV-1a, twice) — identity only,
    /// not security.
    init(fvSeed: String) {
        func fnv(_ seed: UInt64) -> UInt64 {
            var h: UInt64 = seed
            for b in fvSeed.utf8 { h ^= UInt64(b); h = h &* 0x100000001b3 }
            return h
        }
        let a = fnv(0xcbf29ce484222325), b = fnv(0x84222325cbf29ce4)
        var bytes = [UInt8](repeating: 0, count: 16)
        for i in 0..<8 { bytes[i] = UInt8((a >> (8 * UInt64(i))) & 0xff); bytes[8 + i] = UInt8((b >> (8 * UInt64(i))) & 0xff) }
        self = UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}

/// Promoters type event and list names in capitals ("THURSDAY - REGGAETON
/// CLASICOS OTTO 2000"). For display: drop a leading weekday (the date is
/// already shown) and title-case a shouted name, keeping real acronyms.
enum FVText {
    private static let weekdays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday",
                                   "lunes","martes","miércoles","miercoles","jueves","viernes","sábado","sabado","domingo",
                                   "dilluns","dimarts","dimecres","dijous","divendres","dissabte","diumenge"]
    /// Acronyms that have vowels, so the no-vowel rule below doesn't catch them.
    private static let keepUpper: Set<String> = ["VIP","UAB","UPF","UB","EDM","ESN","CSIO","USA","UK","II","III","IV"]
    /// Joining words, lowercased inside a name ("Friday at Midnight").
    private static let small: Set<String> = ["de","del","y","x","by","at","en","the","of","and","a","con","i","per","pres.","is"]
    private static let vowels = Set("aeiouáéíóúàèòïüAEIOUÁÉÍÓÚÀÈÒÏÜ")

    static func pretty(_ raw: String?) -> String? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return raw }
        // Drop a leading weekday ONLY when a separator follows it —
        // "THURSDAY - Reggaeton…" yes; "Fridays at Sutton", "Jueves de La
        // Biblio" no: there the weekday is part of the name.
        let lower = s.lowercased()
        for w in weekdays where lower.hasPrefix(w) {
            let after = s.dropFirst(w.count)
            let trimmed = after.drop { $0 == " " }
            if let c = trimmed.first, "-–—|:·".contains(c) {
                let rest = trimmed.drop { " -–—|:·".contains($0) }
                if !rest.isEmpty { s = String(rest) }
            }
            break
        }
        let letters = s.filter(\.isLetter)
        let shouty = letters.count >= 4 && Double(letters.filter(\.isUppercase).count) / Double(letters.count) > 0.7
        var out: [String] = []
        for (i, word) in s.split(separator: " ", omittingEmptySubsequences: false).enumerated() {
            let w = String(word)
            let core = w.filter(\.isLetter)
            // Joining words first — "BY" and "IS" would otherwise survive as
            // vowel-less or short capitals.
            if i > 0 && w == w.uppercased() && small.contains(w.lowercased()) {
                out.append(w.lowercased()); continue
            }
            // Spanish/Catalan articles in capitals start a name: "LA Biblio" →
            // "La Biblio", "EL MEJOR" → "El Mejor".
            if ["LA", "EL", "LAS", "LOS", "LES"].contains(w) {
                out.append(w.prefix(1) + w.dropFirst().lowercased()); continue
            }
            // Leave alone: empty, already mixed/lower, letters+digits (JM90, B2B),
            // known acronyms, and vowel-less tokens (BCN, DJ, XXL, R&B).
            if core.isEmpty || w != w.uppercased() || w.contains(where: \.isNumber)
                || keepUpper.contains(core.uppercased()) || !core.contains(where: { vowels.contains($0) }) {
                out.append(w); continue
            }
            // In an otherwise normal name, short capitals are usually initials
            // or tags (AJ, BAE) — keep them. In a shouted name, case them.
            if !shouty && core.count <= 3 { out.append(w); continue }
            let l = w.lowercased()
            out.append(l.prefix(1).uppercased() + l.dropFirst())
        }
        return out.joined(separator: " ").replacingOccurrences(of: "  ", with: " ")
    }

    /// "01:00" from whatever the list says: "FREE TILL 1H", "Until 01:00",
    /// "hasta la 01.30h", "fins la 1:30", "antes 00:30h", "ANTES de la 01H".
    static func freeWindow(_ texts: [String?]) -> String? {
        let hay = texts.compactMap { $0 }.joined(separator: " ").lowercased()
        let rx = try? NSRegularExpression(pattern:
            #"(?:till|until|hasta(?: la| las)?|fins(?: a)?(?: la| les)?|antes(?: de)?(?: la| las)?)\s*(\d{1,2})(?:[:.](\d{2})|h)?"#)
        guard let m = rx?.firstMatch(in: hay, range: NSRange(hay.startIndex..., in: hay)),
              let hr = Range(m.range(at: 1), in: hay), let h = Int(hay[hr]), h < 24 else { return nil }
        var min = "00"
        if m.range(at: 2).location != NSNotFound, let r = Range(m.range(at: 2), in: hay) { min = String(hay[r]) }
        return String(format: "%02d:%@", h, min)
    }
}

/// What an entry includes, read from Fourvenues' product name — "Entrada | 1
/// Copa + 1 Chupito (ANTES DE LA 01H)", "EARLY ACCESS +2 DRINKS (ENTRY BEFORE
/// 01:30)", "LISTA de 01:00-01:30". Their names are the only place this lives,
/// in Spanish, English or Catalan; this turns them into "1 drink + 1 shot ·
/// entry before 01:00" so free, paid and paid-with-a-drink read differently.
struct FVPerks: Equatable {
    var drinks = 0
    var shots = 0
    var beerOrSoft = false
    var bottle = false
    var openBar = false
    /// "01:30" — entry must be before this.
    var before: String?
    /// ("19:00", "20:00") — entry within this window.
    var window: (String, String)?

    static func == (a: FVPerks, b: FVPerks) -> Bool {
        a.drinks == b.drinks && a.shots == b.shots && a.beerOrSoft == b.beerOrSoft && a.bottle == b.bottle
            && a.openBar == b.openBar && a.before == b.before && a.window?.0 == b.window?.0 && a.window?.1 == b.window?.1
    }

    var includesSomething: Bool { drinks > 0 || shots > 0 || beerOrSoft || bottle || openBar }

    /// Includes at least everything `o` does. Entry times aren't weighed.
    func covers(_ o: FVPerks) -> Bool {
        (openBar || (drinks >= o.drinks && (beerOrSoft || !o.beerOrSoft || drinks > o.drinks)))
            && (openBar || !o.openBar) && shots >= o.shots && (bottle || !o.bottle)
    }

    init(_ raw: String?) {
        let s = (raw ?? "").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
        func first(_ pattern: String) -> [String]? {
            guard let re = try? NSRegularExpression(pattern: pattern),
                  let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
            return (0..<m.numberOfRanges).map { i in
                Range(m.range(at: i), in: s).map { String(s[$0]) } ?? ""
            }
        }
        let drinkWord = #"(?:copas?|drinks?|consumicio(?:n|ns|nes)?|bebidas?|cubatas?)"#
        if let m = first(#"(\d+)\s*"# + drinkWord) { drinks = Int(m[1]) ?? 1 }
        else if first(#"\b"# + drinkWord + #"\b"#) != nil,
                first(#"\b(?:sin|no incluye|without|no drinks?|sense)\s+(?:\w+\s+)?"# + drinkWord) == nil { drinks = 1 }
        if let m = first(#"(\d+)\s*(?:chupitos?|chupis?|shots?)"#) { shots = Int(m[1]) ?? 1 }
        else if first(#"\b(?:chupitos?|chupis?|shots?)\b"#) != nil { shots = 1 }
        beerOrSoft = first(#"\b(?:cerveza|cervesa|refresco|beer|soft drink)\b"#) != nil
        bottle = first(#"\b(?:botella|ampolla|bottle)\b"#) != nil
        openBar = first(#"\b(?:barra libre|open bar|barra lliure)\b"#) != nil

        func hhmm(_ h: String, _ m: String) -> String {
            String(format: "%02d:%@", Int(h) ?? 0, m.isEmpty ? "00" : m)
        }
        // "de 19:00-20:00", "19h-20:30h", "01:00 a 01:30"
        if let m = first(#"(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:-|–|\ba\b)\s*(\d{1,2})(?::(\d{2}))\s*h?"#)
            ?? first(#"(\d{1,2})(?::(\d{2}))?\s*h\s*(?:-|–)\s*(\d{1,2})(?::(\d{2}))?\s*h"#) {
            window = (hhmm(m[1], m[2]), hhmm(m[3], m[4]))
        } else if let m = first(#"(?:hasta|antes|before|till|until|fins|abans)\s*(?:de\s*)?(?:la\s|las\s|les\s|the\s)?\s*(\d{1,2})(?:[:.](\d{2}))?"#) {
            before = hhmm(m[1], m[2])
        }
    }
}

struct FVWindow: Decodable, Hashable {
    let from: String?
    let until: String?
}

/// One language per guest. Promoters write in Spanish, English, Catalan or
/// both; agentbox (fourvenues_i18n.py) splits and translates every text into
/// {"en", "es"}. Spanish phones get Spanish; everyone else gets English, the
/// fallback for any language we don't carry. If neither is there yet, the
/// promoter's original text.
enum FVLang {
    static func pick(_ i18n: [String: String]?, _ raw: String?, _ locale: String) -> String? {
        let lang = locale == "es" ? "es" : "en"
        return i18n?[lang] ?? i18n?["en"] ?? raw
    }
}

/// The three ways in a guest chooses between, each its own button: the free
/// guestlist, paid entry (fast pass, entry with drinks, pay at the door), and
/// VIP tables. The event sheet opened from a button shows only that tier.
enum FVTier: String, CaseIterable, Identifiable {
    case free, paid, vip
    var id: String { rawValue }

    var settles: [Settle] {
        switch self {
        case .free: [.free]
        case .paid: [.online, .door]
        case .vip: [.table]
        }
    }

    func includes(_ p: FVProduct) -> Bool { settles.contains(p.settle) }
}

/// A table zone's floor plan as Fourvenues draws it: a square background and
/// each table placed by percentages of that square (top/left of its box,
/// width = height, scaled from its centre, then rotated).
struct FVZoneMap: Decodable, Hashable {
    let image: String?
    let spaces: [FVSpace]
    /// The picture already shows the tables — draw tap targets, not shapes,
    /// or an imprecise position reads as a doubled table.
    let painted: Bool
    /// The venue's table positions don't describe this picture — show the
    /// plan, mark no tables (prices are picked from the chips).
    let approx: Bool

    enum CodingKeys: String, CodingKey { case image, spaces, painted, approx }

    init(image: String?, spaces: [FVSpace], painted: Bool = false, approx: Bool = false) {
        self.image = image
        self.spaces = spaces
        self.painted = painted
        self.approx = approx
    }

    /// Never throws: a table we can't read is dropped, not the whole feed —
    /// one unplaced table once made every map (and new night) vanish.
    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        image = (try? c?.decodeIfPresent(String.self, forKey: .image)) ?? nil
        spaces = ((try? c?.decodeIfPresent([FVLossy<FVSpace>].self, forKey: .spaces)) ?? nil)?
            .compactMap(\.value) ?? []
        painted = ((try? c?.decodeIfPresent(Bool.self, forKey: .painted)) ?? nil) ?? false
        approx = ((try? c?.decodeIfPresent(Bool.self, forKey: .approx)) ?? nil) ?? false
    }
}

/// Decodes T if it can, nil otherwise — so one bad element can't fail an array.
struct FVLossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

struct FVSpace: Decodable, Hashable, Identifiable {
    let id: String
    let name: String?
    let cap: Int?
    let top: Double
    let left: Double
    let w: Double
    /// Corner radius as a % of the box (50 = round).
    let r: Double?
    let s: Double?
    let rot: Double?
    /// Blocked by the venue.
    let off: Bool
    /// Already booked tonight.
    let taken: Bool
    /// The rate ids (FVRate.id) this table is sold under.
    let rates: [String]
    let rgb: [Int]?
    /// The table's real outline in the picture, [x, y, w, h] in percent —
    /// traced by agentbox on plans that draw their tables.
    let box: [Double]?

    var available: Bool { !off && !taken }
}

/// "shared": one plan for the whole venue — the overview is that plan with
/// every area's tables; "areas": close-up crops with no common frame — the
/// overview is the areas as tiles. Decodes leniently (never fails the feed).
struct FVVipMap: Decodable, Hashable {
    let shared: Bool
    let overview: String?

    enum CodingKeys: String, CodingKey { case layout, overview }

    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        shared = ((try? c?.decodeIfPresent(String.self, forKey: .layout)) ?? nil) == "shared"
        overview = (try? c?.decodeIfPresent(String.self, forKey: .overview)) ?? nil
    }
}
