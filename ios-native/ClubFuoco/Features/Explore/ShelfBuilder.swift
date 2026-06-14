import Foundation

/// One horizontal row of the explore feed.
struct Shelf: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    var places: [Place]
    var featured = false
}

/// Admin-managed custom shelf from GET /api/explore/shelves.
struct CustomShelfRecord: Decodable, Sendable {
    let id: String
    let title: String
    let subtitle: String?
    let mode: String           // 'auto' | 'manual'
    let autoFilter: String?
    let autoGenre: String?
    let autoSort: String?
    let placeIds: [String]?
    let position: Int
}

/// Native port of the explore shelf algorithm. Phase 1 ports the structural
/// core: featured partner hero + the rotating candidate pool (keyword shelves)
/// + admin custom shelves + the lead-staggering pass. The survey/taste-profile
/// personalisation scoring and events/rumbas shelves land in Phase 2.
enum ShelfBuilder {
    typealias Localize = (String) -> String

    static func build(places: [Place], custom: [CustomShelfRecord], t: Localize) -> [Shelf] {
        var shelves: [Shelf] = []

        // ── Featured hero — Rumbalist clubs only (those with a Rumbalist offer) ─
        let partners = places.filter { !RumbalistOffers.offers(for: $0.placeId).isEmpty }
        if !partners.isEmpty {
            shelves.append(Shelf(
                id: "hero",
                title: t("shelf.hero.title"),
                subtitle: t("shelf.hero.sub"),
                places: Array(partners.prefix(12)),
                featured: true
            ))
        }

        // ── Rotating pool — keyword/quality candidates, shuffled per load ────
        var pool: [Shelf] = []
        func candidate(_ id: String, _ pts: [Place], min: Int = 2) {
            if pts.count >= min {
                pool.append(Shelf(
                    id: id,
                    title: t("shelf.\(id).title"),
                    subtitle: t("shelf.\(id).sub"),
                    places: Array(pts.prefix(12))
                ))
            }
        }

        let byRating: (Place, Place) -> Bool = { ($0.rating ?? 0) > ($1.rating ?? 0) }
        let byPopular: (Place, Place) -> Bool = { $0.ratingsTotal > $1.ratingsTotal }

        // Quality
        candidate("top_rated", places.filter { $0.rating != nil && $0.ratingsTotal > 30 }.sorted(by: byRating))
        candidate("icons", places.filter { $0.ratingsTotal > 300 }.sorted(by: byPopular), min: 3)
        candidate("gems", places.filter { ($0.rating ?? 0) >= 4.0 && $0.ratingsTotal < 300 }.sorted(by: byRating))
        candidate("value", places.filter { ($0.generalEntryPrice ?? 0) == 0 && ($0.rating ?? 0) >= 3.5 }.sorted(by: byRating))
        candidate("partner", places.filter(\.isPartner).sorted(by: byRating), min: 1)
        candidate("featured", places.filter(\.isFeatured).sorted(by: byRating), min: 1)
        candidate("most_popular", places.sorted(by: byPopular))
        candidate("local_fav", places.filter { ($0.rating ?? 0) >= 4.0 }.shuffled())

        // Venue type
        candidate("clubs", places.filter { $0.matches(["club", "disco", "discoteca", "sala", "nightclub"]) }.sorted(by: byRating))
        candidate("bars", places.filter { $0.matches(["bar", "lounge", "pub", "tavern"]) }.sorted(by: byRating))
        candidate("cocktail", places.filter { $0.matches(["cocktail", "mixology", "speakeasy", "craft", "gin"]) }.sorted(by: byRating))
        candidate("rooftop", places.filter { $0.matches(["rooftop", "roof", "sky", "terraza", "terrace", "terrat"]) }.sorted(by: byRating))
        candidate("live_music", places.filter { $0.matches(["live", "music", "jazz", "concert", "acoustic", "sala"]) }.sorted(by: byRating))

        // Music genres
        candidate("techno", places.filter { $0.matches(["techno", "industrial", "bunker", "raw", "underground", "hard"]) }.sorted(by: byRating))
        candidate("house", places.filter { $0.matches(["house", "groove", "deep", "afro", "funky"]) }.sorted(by: byRating))
        candidate("latin", places.filter { $0.matches(["latin", "salsa", "mambo", "cubano", "caribe", "tropical", "merengue"]) }.sorted(by: byRating))

        // Neighbourhoods
        candidate("gothic", places.filter { $0.matches(["gothic", "gòtic", "barri", "gotic", "call", "ferran", "escudellers"]) }.sorted(by: byRating))
        candidate("born", places.filter { $0.matches(["born", "borne", "sant pere", "princesa", "comerç", "montcada"]) }.sorted(by: byRating))
        candidate("eixample", places.filter { $0.matches(["eixample", "gran via", "diagonal", "provença", "consell de cent", "muntaner", "enric granados"]) }.sorted(by: byRating))
        candidate("gracia", places.filter { $0.matches(["gràcia", "gracia", "verdi", "travessera", "fontana", "lesseps", "torrent"]) }.sorted(by: byRating))

        // Occasion
        candidate("date_night", places.filter { $0.matches(["cocktail", "wine", "lounge", "bistro", "speakeasy", "jazz", "rooftop"]) && ($0.rating ?? 0) >= 3.8 }.sorted(by: byRating))
        candidate("pre_drinks", places.filter { $0.matches(["bar", "pub", "lounge", "café"]) }.sorted(by: byRating))
        candidate("first_timer", places.filter { $0.ratingsTotal > 200 }.sorted(by: byPopular))

        shelves.append(contentsOf: pool.shuffled())

        let valid = shelves.filter { !$0.places.isEmpty }

        // ── Stagger pass: each shelf leads with a venue not already leading ──
        var usedAsLead = Set<String>()
        var staggered: [Shelf] = []
        for var shelf in valid {
            if shelf.featured {
                shelf.places.prefix(4).forEach { usedAsLead.insert($0.placeId) }
                staggered.append(shelf)
                continue
            }
            let fresh = shelf.places.filter { !usedAsLead.contains($0.placeId) }
            let repeats = shelf.places.filter { usedAsLead.contains($0.placeId) }
            shelf.places = fresh + repeats
            shelf.places.prefix(3).forEach { usedAsLead.insert($0.placeId) }
            staggered.append(shelf)
        }

        return mergeCustomShelves(base: staggered, records: custom, places: places)
    }

    /// Port of mergeCustomShelves(): default rows stay; custom shelves splice
    /// in at their `position` (1 = right after the hero).
    static func mergeCustomShelves(base: [Shelf], records: [CustomShelfRecord], places: [Place]) -> [Shelf] {
        guard !records.isEmpty else { return base }
        var result = base
        let index = Dictionary(uniqueKeysWithValues: places.map { ($0.placeId, $0) })

        for rec in records.sorted(by: { $0.position < $1.position }) {
            var picks: [Place] = []
            if rec.mode == "manual" {
                picks = (rec.placeIds ?? []).compactMap { index[$0.lowercased()] }
            } else {
                var pool = places
                switch rec.autoFilter {
                case "partner": pool = pool.filter(\.isPartner)
                case "featured": pool = pool.filter(\.isFeatured)
                case "open": pool = pool.filter { $0.isOpen == true }
                case "genre":
                    let g = (rec.autoGenre ?? "").lowercased().trimmingCharacters(in: .whitespaces)
                    if !g.isEmpty { pool = pool.filter { $0.matches([g]) } }
                default: break
                }
                switch rec.autoSort {
                case "rating": pool.sort { ($0.rating ?? 0) > ($1.rating ?? 0) }
                case "popular": pool.sort { $0.ratingsTotal > $1.ratingsTotal }
                default: pool.shuffle()
                }
                picks = Array(pool.prefix(12))
            }

            guard picks.count >= (rec.mode == "manual" ? 1 : 2) else { continue }
            let shelf = Shelf(id: "custom_\(rec.id)", title: rec.title, subtitle: rec.subtitle ?? "", places: picks)
            let at = min(max(rec.position, 1), result.count)
            result.insert(shelf, at: at)
        }
        return result
    }

    // ── Filter chips (port of FILTER_CHIPS + filterPlaces) ────────────────────

    static let filterChips: [(id: String, labelKey: String)] = [
        ("all", "chip.all"), ("free", "chip.free"), ("cocktails", "chip.cocktails"),
        ("live", "chip.live"), ("dancing", "chip.dancing"), ("rooftop", "chip.rooftop"),
        ("techno", "chip.techno"), ("house", "chip.house"), ("latin", "chip.latin"),
    ]

    static func filter(_ places: [Place], chip: String) -> [Place] {
        switch chip {
        case "free": return places.filter { $0.priceLevel == 0 || $0.generalEntryPrice == 0 }
        case "cocktails": return places.filter { $0.matches(["cocktail"]) }
        case "live": return places.filter { $0.matches(["live", "jazz", "music", "concert"]) }
        case "dancing": return places.filter { $0.matches(["danc", "disco", "club"]) }
        case "rooftop": return places.filter { $0.matches(["roof", "terraza", "terrace"]) }
        case "techno": return places.filter { $0.matches(["techno"]) }
        case "house": return places.filter { $0.matches(["house"]) }
        case "latin": return places.filter { $0.matches(["latin", "salsa", "reggaeton"]) }
        default: return places
        }
    }
}
