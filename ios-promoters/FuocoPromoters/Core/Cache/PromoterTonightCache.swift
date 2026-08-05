import Foundation

/// Stale-while-revalidate snapshot of the promoter's Tonight feed (their nights
/// + series). Persisted after each successful load so a cold launch paints the
/// last-known feed instantly instead of spinning while the two queries run, then
/// refreshes in the background.
struct PromoterTonightSnapshot: Codable {
    var allocations: [PromoterAllocation]
    var series: [PromoterSeries]
    var savedAt: Date
}

enum PromoterTonightCache {
    /// A promoter's own schedule changes slowly; anything older than this is
    /// discarded rather than flashed before the refresh lands.
    private static let maxAge: TimeInterval = 3 * 24 * 3600

    private static var url: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("promoter-tonight.json")
    }

    static func load() -> PromoterTonightSnapshot? {
        guard let url,
              let data = try? Data(contentsOf: url),
              let snap = try? JSONDecoder().decode(PromoterTonightSnapshot.self, from: data),
              Date().timeIntervalSince(snap.savedAt) < maxAge
        else { return nil }
        return snap
    }

    static func save(_ snapshot: PromoterTonightSnapshot) {
        // Encode on the caller (cheap for a promoter's own small feed), then
        // write off-actor so persisting never hitches the UI.
        guard let url, let data = try? JSONEncoder().encode(snapshot) else { return }
        Task.detached(priority: .utility) {
            try? data.write(to: url, options: .atomic)
        }
    }
}
