import SwiftUI
import UIKit

/// Drop-in replacement for SwiftUI's `AsyncImage` that actually caches decoded
/// images.
///
/// `AsyncImage` keeps no cache: every time a card is recycled in a `LazyVStack`
/// / `ScrollView` (or the feed re-renders) it discards the decoded image and
/// re-downloads from scratch, so photos flash their grey placeholder and load
/// inconsistently while scrolling. This keeps an in-memory cache for instant,
/// flash-free redisplay on top of a shared disk-backed `URLCache` that survives
/// relaunches. The API mirrors `AsyncImage(url:content:placeholder:)` so it's a
/// direct swap at every call site.
struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    private let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder

    @State private var uiImage: UIImage?

    init(
        url: URL?,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
        // Seed synchronously from the in-memory cache so an already-fetched
        // image shows on the very first frame — no placeholder flash on reuse.
        _uiImage = State(initialValue: url.flatMap { ImageCache.shared.cached(for: $0) })
    }

    var body: some View {
        Group {
            if let uiImage {
                content(Image(uiImage: uiImage))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else { uiImage = nil; return }
            if let cached = ImageCache.shared.cached(for: url) {
                uiImage = cached
                return
            }
            if let loaded = await ImageCache.shared.load(url) {
                uiImage = loaded
            }
        }
    }
}

/// In-memory (`NSCache`) + disk-backed (`URLCache`) image cache shared across
/// the app. Coalesces concurrent requests for the same URL so the same photo
/// isn't fetched twice when several cards reference it.
actor ImageCache {
    static let shared = ImageCache()

    private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]

    private init() {
        memory.countLimit = 250
        let cache = URLCache(
            memoryCapacity: 32 * 1024 * 1024,   // 32 MB
            diskCapacity: 256 * 1024 * 1024     // 256 MB
        )
        let config = URLSessionConfiguration.default
        config.urlCache = cache
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
    }

    /// Synchronous in-memory lookup — safe to call from a view initializer.
    /// `NSCache` is thread-safe, so reaching across the actor boundary here is
    /// intentional and avoids a placeholder flash on cell reuse.
    nonisolated func cached(for url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func load(_ url: URL) async -> UIImage? {
        if let image = memory.object(forKey: url as NSURL) { return image }
        if let existing = inFlight[url] { return await existing.value }

        let task = Task<UIImage?, Never> { [session] in
            guard
                let (data, _) = try? await session.data(from: url),
                let image = UIImage(data: data)
            else { return nil }
            return image
        }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image { memory.setObject(image, forKey: url as NSURL) }
        return image
    }
}
