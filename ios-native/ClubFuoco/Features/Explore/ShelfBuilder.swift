import Foundation

/// One horizontal row of the explore feed. Hashable so the "N venues →"
/// header button can push the full list via `NavigationLink(value:)`.
struct Shelf: Identifiable, Hashable, Codable, Sendable {
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

/// Native port of the explore shelf algorithm: featured deal hero + the
/// rotating candidate pool (keyword shelves) + admin custom shelves + the
/// lead-staggering pass, with the web's deal-first tiering and
/// survey/taste-profile personalisation scoring (PersonalizationScore).
/// The events/rumbas shelves still land in Phase 2.
enum ShelfBuilder {
    typealias Localize = (String) -> String

    /// Monetisable-first tiering (the dominant sort term), derived per build
    /// from live data — a venue gaining or losing an offer or an event
    /// re-tiers on the next build with no code or config change.
    ///   tier 0  live offer running on the planned night (validDays enforced,
    ///           skippedDates respected).  sub: vipTable before freeGuestlist
    ///   tier 1  live offer, but not that night
    ///   tier 2  ticketed event.           sub: event on the planned night first
    ///   tier 3  nothing to sell
    /// Deals outrank events and events outrank plain venues, always — a lower
    /// tier can never be beaten by personalisation score.
    /// Mirrors the web's dealRank() in explore/page.tsx; change both together.
    private struct DealRank {
        let tier: Int
        let subRank: Int
        let score: Double
    }

    static func build(
        places: [Place],
        custom: [CustomShelfRecord],
        offersByClub: [String: [RumbalistOffer]] = [:],
        events: [ExternalEvent] = [],
        planDate: String = "",
        prefs: UserPreferences? = nil,
        survey: SurveyPreferences? = nil,
        taste: TasteProfile? = nil,
        t: Localize
    ) -> [Shelf] {
        var shelves: [Shelf] = []

        var dealRanks: [String: DealRank] = [:]
        dealRanks.reserveCapacity(places.count)
        for p in places {
            let offers = offersByClub[p.placeId.lowercased()] ?? []
            let live = offers.filter { $0.liveOn(planDate) }
            // Event days for this venue (fuzzy name match, like the web).
            let eventDays = Set(events
                .filter { VenueMatch.matches($0.venueName, p.name) }
                .compactMap(\.calendarDay))

            let tier: Int
            let subRank: Int
            if !live.isEmpty {
                // A paid front-screen (featured) offer running tonight outranks
                // even regular deals — the hero tier the promoter pays for.
                tier = live.contains(where: \.featured) ? -1 : 0
                subRank = live.contains(where: \.isVip) ? 0 : 1
            } else if !offers.isEmpty {
                tier = 1; subRank = 0
            } else if !eventDays.isEmpty {
                tier = 2; subRank = eventDays.contains(planDate) ? 0 : 1
            } else {
                tier = 3; subRank = 0
            }

            dealRanks[p.placeId] = DealRank(
                tier: tier,
                subRank: subRank,
                score: PersonalizationScore.prefScore(p, prefs: prefs, survey: survey, taste: taste)
            )
        }
        let fallback = DealRank(tier: 3, subRank: 0, score: 0)
        func rank(_ p: Place) -> DealRank { dealRanks[p.placeId] ?? fallback }

        /// Stable re-sort: tier first, sub-rank within tier, then score; equal
        /// entries keep the incoming order (rating, shuffle, …) — Swift's
        /// sorted(by:) is documented stable.
        func ranked(_ arr: [Place]) -> [Place] {
            arr.sorted { a, b in
                let ra = rank(a), rb = rank(b)
                if ra.tier != rb.tier { return ra.tier < rb.tier }
                if ra.subRank != rb.subRank { return ra.subRank < rb.subRank }
                return ra.score > rb.score
            }
        }

        // ── Featured hero — venues with a live offer on the planned night ────
        // Exactly the tier-0 set; empty set → no shelf at all. Shuffled per
        // build like the rotating pool: feed order is most-rated-first, which
        // made Pacha the big hero card on every single load. Every partner
        // gets its turn as the lead.
        let partners = places.filter { rank($0).tier <= 0 }.shuffled()
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
        // Every candidate goes deal-first via ranked(); its own sort order
        // (rating/popularity/shuffle) survives as the within-tier tie-break.
        var pool: [Shelf] = []
        func candidate(_ id: String, _ pts: [Place], min: Int = 2) {
            if pts.count >= min {
                pool.append(Shelf(
                    id: id,
                    title: t("shelf.\(id).title"),
                    subtitle: t("shelf.\(id).sub"),
                    places: Array(ranked(pts).prefix(12))
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
            // The stagger would happily pull a no-deal venue ahead of a deal
            // venue just because the deal venue already led another shelf.
            // Re-assert tier order afterwards — a stable sort, so the stagger
            // still decides the order WITHIN a tier, it just can't cross tiers.
            shelf.places = (fresh + repeats).sorted { a, b in
                let ra = rank(a), rb = rank(b)
                if ra.tier != rb.tier { return ra.tier < rb.tier }
                return ra.subRank < rb.subRank
            }
            shelf.places.prefix(3).forEach { usedAsLead.insert($0.placeId) }
            staggered.append(shelf)
        }

        // Admin shelves run through the same ranker as every other row.
        return mergeCustomShelves(base: staggered, records: custom, places: places, rank: ranked)
    }

    /// Port of mergeCustomShelves(): default rows stay; custom shelves splice
    /// in at their `position` (1 = right after the hero).
    static func mergeCustomShelves(
        base: [Shelf],
        records: [CustomShelfRecord],
        places: [Place],
        rank: ([Place]) -> [Place] = { $0 }
    ) -> [Shelf] {
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
            // Deal/event venues lead every row, custom shelves included. This
            // also reorders a MANUAL shelf's hand-picked list: the commercial
            // ordering outranks the admin's arrangement (the admin still
            // controls membership).
            picks = rank(picks)
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
