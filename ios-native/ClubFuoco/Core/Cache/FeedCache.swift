import Foundation

/// Stale-while-revalidate snapshot of the explore feed. Persisted after each
/// successful load so a cold launch can paint the last-known feed instantly and
/// refresh in the background, rather than sitting on a skeleton while every
/// request completes. Venues change slowly, so a few-day-old snapshot is fine to
/// show for the ~1s a refresh takes; anything older is discarded.
struct FeedSnapshot: Codable, Sendable {
    var places: [Place]
    var shelves: [Shelf]
    var saved: [String]
    var planDate: String
    var savedAt: Date
}

enum FeedCache {
    /// Beyond this the snapshot is too stale to flash before the refresh lands.
    private static let maxAge: TimeInterval = 7 * 24 * 3600

    private static var url: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("explore-feed.json")
    }

    static func load() -> FeedSnapshot? {
        guard let url,
              let data = try? Data(contentsOf: url),
              let snap = try? JSONDecoder().decode(FeedSnapshot.self, from: data),
              !snap.places.isEmpty,
              Date().timeIntervalSince(snap.savedAt) < maxAge
        else { return nil }
        return snap
    }

    static func save(_ snapshot: FeedSnapshot) {
        guard let url else { return }
        // Encode + write off the main actor so persisting the whole feed never
        // hitches the UI on the load that just finished.
        Task.detached(priority: .utility) {
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: url, options: .atomic)
        }
    }
}
