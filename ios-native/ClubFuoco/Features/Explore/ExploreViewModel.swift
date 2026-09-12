import Foundation
import Observation

/// Drives the explore feed: nearby clubs via PostgREST (mirrors the web's
/// direct-query path), favorites, admin custom shelves via the REST API, and
/// the shelf-building pipeline. Geolocation is Phase 2 — Barcelona center is
/// the web fallback and the dominant real-world case.
/// Envelope of GET /api/events/feed.
/// One entry on the editorial featured shelf (/api/featured). A reference, not
/// a copy: the id resolves against data the feed already holds — a night in
/// `feedEvents`, or a venue in `places` (whose `placeId` IS the lowercased
/// club id). That keeps a featured card byte-identical to the same card
/// unfeatured, because it IS the same card.
struct FeaturedRef: Decodable, Sendable, Hashable {
    let kind: String        // "event" | "venue" | "auto"
    let id: String
}

struct FeaturedPayload: Decodable, Sendable {
    let tier1: [FeaturedRef]
    let tier2: [FeaturedRef]
}

struct EventsPayload: Decodable, Sendable {
    let events: [FeedEvent]
}

@MainActor
@Observable
final class ExploreViewModel {
    static let barcelona = (lat: 41.3851, lng: 2.1734)

    enum LoadState {
        case loading
        case loaded
        case failed(String)
    }

    private(set) var state: LoadState = .loading

    /// LoadState carries an associated value on `.failed`, so it isn't
    /// auto-Equatable — this is the "is there already a feed on screen?" check.
    private var isLoaded: Bool {
        if case .loaded = state { return true }
        return false
    }
    private(set) var places: [Place] = []
    private(set) var customShelves: [CustomShelfRecord] = []
    private(set) var saved: Set<String> = []
    private(set) var rumbas: [Rumba] = []

    /// The LIVE offer set, keyed by lowercased club id — fetched per load, the
    /// only deal signal the ranking may use. Empty when the request failed or
    /// nothing is live: everything drops a tier and the feed still renders.
    private(set) var offersByClub: [String: [RumbalistOffer]] = [:]

    /// Upcoming ticketed events, used as the secondary commercial signal
    /// (ranked below deals). Empty on failure — the feed still renders.
    private(set) var events: [ExternalEvent] = []

    /// Club ids with a Featured DJ — boosted in the ranking so programmed
    /// venues surface instead of the same popular names repeating.
    private(set) var djClubIds: Set<String> = []

    /// OUR events — promoter nights and house nights, already gated and ordered
    /// by the server (editorial pin, then paid promotion, then soonest). They
    /// sit at the top of the feed rather than in a tab of their own. Empty on
    /// failure: the venue feed must still render.
    private(set) var feedEvents: [FeedEvent] = []

    /// The editorial featured shelf from /portal/featured. Empty when nothing
    /// is featured or the request failed, which is what makes the automatic
    /// shelf below the fallback rather than a competing path.
    private(set) var featured = FeaturedPayload(tier1: [], tier2: [])

    /// Tier 1, resolved: the big card. The FIRST ref that yields anything wins,
    /// so a standby below it covers the night the top one has passed. Nil when
    /// nothing is featured or nothing resolves — the venue hero then leads, as
    /// it did before there was a desk.
    var featuredHero: FeaturedItem? {
        featured.tier1.lazy.flatMap { self.expand($0, limit: 1) }.first
    }

    /// Tier 2, resolved and in order: what leads the line under the hero.
    /// A rule expands to many cards, a named pick to exactly one.
    var featuredRow: [FeaturedItem] {
        featured.tier2.flatMap { self.expand($0, limit: 12) }
    }

    /// A ref becomes cards only if what it points at is actually here. A venue
    /// outside the loaded radius, or a night that has dropped out of the
    /// events feed, yields nothing rather than an empty card.
    ///
    /// An `auto` ref is a RULE, so it expands to as many cards as the slot can
    /// use — one in the hero, a rowful underneath.
    private func expand(_ ref: FeaturedRef, limit: Int) -> [FeaturedItem] {
        switch ref.kind {
        case "event":
            return feedEvents.first { $0.id == ref.id }.map { [FeaturedItem.event($0)] } ?? []
        case "venue":
            return places.first { $0.placeId.lowercased() == ref.id }.map { [FeaturedItem.place($0)] } ?? []
        case "auto":
            let ranked = ref.id == "organic" ? organicPlaces : revenuePlaces
            return ranked.prefix(limit).map(FeaturedItem.place)
        default:
            return []
        }
    }

    /// The 'revenue' rule: exactly what the shelf already ranked — offers and
    /// paid promotion first (ShelfBuilder's dealRank). Naming it doesn't change
    /// it; it makes it a choice rather than the only behaviour.
    var revenuePlaces: [Place] {
        shelves.first(where: { $0.featured })?.places ?? []
    }

    /// The 'organic' rule: what we would show if we earned nothing from any of
    /// it. No offer, paid-feature or billing signal is consulted — only taste
    /// match, real programming (a booked DJ) and public rating.
    var organicPlaces: [Place] {
        places.sorted { organicScore($0) > organicScore($1) }
    }

    private func organicScore(_ p: Place) -> Double {
        PersonalizationScore.prefScore(p, prefs: userPrefs, survey: surveyPrefs, taste: tasteProfile)
            + (djClubIds.contains(p.placeId) ? 40 : 0)
            + (p.rating ?? 0) * 10
    }

    /// The one event promoted to the big card at the head of the featured box,
    /// in place of the venue that would otherwise lead it.
    ///
    /// ONLY a pinned event takes that slot. Pinning is the portal's editorial
    /// call — the difference between "highlight this" and "this is just on" —
    /// so an unpinned event mixes in with the venues instead of displacing
    /// one. The old behaviour fell back to the soonest event, which meant the
    /// feed always led with an event whether or not anyone had chosen it.
    var leadEvent: FeedEvent? { feedEvents.first { $0.pinned } }

    /// The events that mix into the featured shelf alongside the venues —
    /// everything except whichever one is leading it.
    var mixedEvents: [FeedEvent] { feedEvents.filter { $0.id != leadEvent?.id } }

    // Personalisation inputs (nil for guests / on error → unpersonalised feed).
    private(set) var userPrefs: UserPreferences?
    private(set) var surveyPrefs: SurveyPreferences?
    private(set) var tasteProfile: TasteProfile?

    /// Built once per (places, filter, plan-date) change — NOT per render.
    /// The shelf pool is shuffled, so rebuilding in `body` would change view
    /// identity every evaluation and restart every AsyncImage mid-flight.
    private(set) var shelves: [Shelf] = []

    var search = ""
    var showSearch = false
    var showSaved = false
    var activeFilter = "all"

    private var queries: Queries?
    private var api: APIClient?

    private var didHydrate = false
    /// Set once the first background refresh of this launch has been kicked off,
    /// so reappearing (back from a club, tab switch) doesn't re-fetch and
    /// reshuffle the feed the user was just browsing.
    var didRefresh = false

    func configure(queries: Queries, api: APIClient) {
        self.queries = queries
        self.api = api
    }

    /// Paint the last-known feed from disk before the network is even touched
    /// (stale-while-revalidate). No-op after the first call, when there's no
    /// snapshot, or once something is already on screen — the caller then does a
    /// silent refresh. Reuses the *built* shelves so the render matches the
    /// cached one exactly (the shelf pool is shuffled per build); only when the
    /// planned night changed do we rebuild for the new date.
    func hydrateFromCache(planDate: String, t: (String) -> String) {
        guard !didHydrate else { return }
        didHydrate = true
        guard places.isEmpty, let snap = FeedCache.load() else { return }

        places = snap.places
        saved = Set(snap.saved)
        if snap.planDate == planDate {
            shelves = snap.shelves
        } else {
            rebuildShelves(planDate: planDate, t: t)
        }
        state = .loaded
    }

    /// Loads the feed. The core venue list is the only request the feed can't
    /// render without, so it's awaited first and painted immediately; the
    /// API-backed extras (custom shelves, live offers, personalisation) then
    /// enrich a second build a beat later. When a cached feed is already on
    /// screen this runs as a silent refresh — no skeleton, one atomic swap.
    func load(planDate: String, t: (String) -> String) async {
        guard let queries, let api else { return }
        if places.isEmpty { state = .loading }

        async let favorites = (try? queries.placeFavoriteIds()) ?? []
        async let customShelvesReq: [CustomShelfRecord]? = try? await api.get("/api/explore/shelves")
        async let activeRumbas: [Rumba]? = try? await api.get("/api/rumbas")
        // Live offers + personalisation inputs ride the same group so nothing
        // serialises; they're folded into the enriched build below.
        async let liveOffers = RumbalistOffers.fetchLive(api: api)
        async let upcoming = (try? queries.upcomingEvents()) ?? []
        // Our own events. Public route, so guests get them too.
        async let ourEvents: EventsPayload? = try? await api.get("/api/events/feed")
        // What the portal has chosen to feature. Public and failure-tolerant:
        // nil simply means the automatic shelf stands.
        async let featuredReq: FeaturedPayload? = try? await api.get("/api/featured")
        async let djClubs = (try? queries.djClubIds()) ?? []
        async let prefs = try? queries.userPreferences()
        // Survey profile comes from the API route — the derivation lives once,
        // server-side, and is shared with the web feed. Guests 401 → nil.
        async let survey: SurveyPreferences? = try? await api.get("/api/surveys/preferences")
        async let taste = try? queries.tasteProfile()

        do {
            var loaded = try await queries.nearbyClubs(
                lat: Self.barcelona.lat, lng: Self.barcelona.lng, radius: 8000
            )
            for i in loaded.indices {
                loaded[i].distance = Self.haversineKm(
                    Self.barcelona.lat, Self.barcelona.lng, loaded[i].lat, loaded[i].lng
                )
            }
            places = loaded
            // Warm the cache for the cover photos most likely to be on screen
            // first, at the shared feed thumbnail size — cards then paint from
            // memory instead of each kicking off its own download.
            ImageCache.shared.prefetchThumbnails(
                loaded.prefix(18).compactMap(\.coverPhoto))
        } catch {
            // Keep any cached/prior feed on screen; only surface the error when
            // there's genuinely nothing to show.
            if !isLoaded { state = .failed(error.localizedDescription) }
            return
        }

        // First paint (cold start only — a warm/cached feed is already .loaded).
        // Base shelves rank without the deal signal for a beat; the enriched
        // build below folds offers in and swaps once.
        if !isLoaded {
            rebuildShelves(planDate: planDate, t: t)
            state = .loaded
        }

        saved = await favorites
        customShelves = await customShelvesReq ?? []
        rumbas = await activeRumbas ?? []
        // nil = the offers request FAILED → no deal signal (tier 2 for
        // everything); the feed must still render, never block on offers.
        offersByClub = await liveOffers ?? [:]
        events = await upcoming
        feedEvents = await ourEvents?.events ?? []
        featured = await featuredReq ?? FeaturedPayload(tier1: [], tier2: [])
        djClubIds = await djClubs
        userPrefs = await prefs ?? nil
        surveyPrefs = await survey ?? nil
        tasteProfile = await taste ?? nil

        rebuildShelves(planDate: planDate, t: t)
        state = .loaded

        // Persist for the next cold launch (stale-while-revalidate).
        FeedCache.save(FeedSnapshot(
            places: places, shelves: shelves, saved: Array(saved),
            planDate: planDate, savedAt: Date()
        ))
    }

    /// Feed scoped to venues open on the planned night, the active chip, and
    /// assembled into shelves (mirrors the page-level pipeline).
    func rebuildShelves(planDate: String, t: (String) -> String) {
        let nightAll = places.filter { Hours.isOpenOnDate($0.weekdayHours, date: planDate) != false }
        let filtered = ShelfBuilder.filter(nightAll, chip: activeFilter)
        shelves = ShelfBuilder.build(
            places: filtered,
            custom: customShelves,
            offersByClub: offersByClub,
            events: events,
            djClubIds: djClubIds,
            planDate: planDate,
            prefs: userPrefs,
            survey: surveyPrefs,
            taste: tasteProfile,
            t: t
        )
    }

    var searchResults: [Place] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return places.filter { place in
            if place.name.lowercased().contains(q) { return true }
            if place.address.lowercased().contains(q) { return true }
            if place.neighborhood?.lowercased().contains(q) == true { return true }
            // Genres + tags are snake_case ("live_music", "beach_club") —
            // match the raw value AND the spaced form so "house music",
            // "shisha", "club" etc. all hit.
            return (place.musicGenres + place.tags).contains { value in
                let v = value.lowercased()
                return v.contains(q) || v.replacingOccurrences(of: "_", with: " ").contains(q)
            }
        }
    }

    var savedPlaces: [Place] {
        places.filter { saved.contains($0.placeId) }
    }

    /// Optimistic save/unsave (mirrors handleSave). Returns false when the
    /// action needs an account (guest gate — Guideline 5.1.1(v)).
    func toggleSave(_ place: Place, isSignedIn: Bool) -> Bool {
        guard isSignedIn, let queries else { return false }

        let wasSaved = saved.contains(place.placeId)
        if wasSaved { saved.remove(place.placeId) } else { saved.insert(place.placeId) }
        Haptics.tap()

        Task {
            do {
                if wasSaved {
                    try await queries.removePlaceFavorite(placeId: place.placeId)
                } else {
                    try await queries.savePlaceFavorite(place)
                }
            } catch {
                // Revert on failure
                if wasSaved { self.saved.insert(place.placeId) } else { self.saved.remove(place.placeId) }
            }
        }
        return true
    }

    static func haversineKm(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
        let r = 6371.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLng = (lng2 - lng1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLng / 2) * sin(dLng / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    static func formatDistance(_ km: Double) -> String {
        km < 1 ? "\(Int((km * 1000).rounded())) m" : String(format: "%.1f km", km)
    }
}
