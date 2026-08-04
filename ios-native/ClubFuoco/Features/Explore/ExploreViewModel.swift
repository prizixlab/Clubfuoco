import Foundation
import Observation

/// Drives the explore feed: nearby clubs via PostgREST (mirrors the web's
/// direct-query path), favorites, admin custom shelves via the REST API, and
/// the shelf-building pipeline. Geolocation is Phase 2 — Barcelona center is
/// the web fallback and the dominant real-world case.
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
