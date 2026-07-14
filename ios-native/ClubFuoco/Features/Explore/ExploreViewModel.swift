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
    private(set) var places: [Place] = []
    private(set) var customShelves: [CustomShelfRecord] = []
    private(set) var saved: Set<String> = []
    private(set) var rumbas: [Rumba] = []

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

    func configure(queries: Queries, api: APIClient) {
        self.queries = queries
        self.api = api
    }

    /// Loads the feed and builds shelves BEFORE flipping state to .loaded —
    /// otherwise the feed renders with empty shelves for the seconds the
    /// custom-shelves/rumbas requests are still in flight, flashing the
    /// "No clubs found nearby" empty state.
    func load(planDate: String, t: (String) -> String) async {
        guard let queries, let api else { return }
        if places.isEmpty { state = .loading }

        async let favorites = (try? queries.placeFavoriteIds()) ?? []
        async let shelves: [CustomShelfRecord]? = try? await api.get("/api/explore/shelves")
        async let activeRumbas: [Rumba]? = try? await api.get("/api/rumbas")

        var loadError: String?
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
        } catch {
            loadError = error.localizedDescription
        }

        saved = await favorites
        customShelves = await shelves ?? []
        rumbas = await activeRumbas ?? []

        if let loadError {
            state = .failed(loadError)
        } else {
            rebuildShelves(planDate: planDate, t: t)
            state = .loaded
        }
    }

    /// Feed scoped to venues open on the planned night, the active chip, and
    /// assembled into shelves (mirrors the page-level pipeline).
    func rebuildShelves(planDate: String, t: (String) -> String) {
        let nightAll = places.filter { Hours.isOpenOnDate($0.weekdayHours, date: planDate) != false }
        let filtered = ShelfBuilder.filter(nightAll, chip: activeFilter)
        shelves = ShelfBuilder.build(places: filtered, custom: customShelves, t: t)
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
