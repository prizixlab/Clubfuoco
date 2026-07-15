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

    /// `targetWidth` (points) requests a right-sized image for the slot it's
    /// shown in: Google Places photo URLs bake in a fixed `maxwidth` (we store
    /// 800), so a 150pt card was downloading a 5x-oversized photo. Passing the
    /// display width rewrites `maxwidth` to the pixels we actually need, which
    /// cuts the bytes on the wire — and the decode cost — dramatically. Omit it
    /// (nil) to fetch at the URL's native size, e.g. for a full-bleed hero.
    init(
        url: URL?,
        targetWidth: CGFloat? = nil,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        let resolved: URL? = {
            guard let url, let targetWidth else { return url }
            let px = Int((targetWidth * UIScreen.main.scale).rounded(.up))
            return url.placesPhotoSized(maxWidthPx: px)
        }()
        self.url = resolved
        self.content = content
        self.placeholder = placeholder
        // Seed synchronously from the in-memory cache so an already-fetched
        // image shows on the very first frame — no placeholder flash on reuse.
        _uiImage = State(initialValue: resolved.flatMap { ImageCache.shared.cached(for: $0) })
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

/// One thumbnail width for every non-hero feed card, so a venue's cover photo
/// resolves to a SINGLE cache entry no matter which card type shows it — that
/// makes prefetching effective (warm once, reused everywhere) and halves the
/// bytes vs. the stored 800px. Crisp for both the 220-wide and 150-wide cards.
enum FeedImage {
    static let thumbWidth: CGFloat = 220
}

extension URL {
    /// Rewrite a Google Places photo URL's `maxwidth` to the pixels a slot
    /// actually shows. We store these URLs with `maxwidth=800`; a thumbnail
    /// only needs a few hundred pixels, so this is the single biggest lever on
    /// image load time (bytes scale with the square of the dimension). Clamped
    /// to a sane range and left unchanged for any non-Places URL (Supabase
    /// storage, etc.), so it's always safe to call.
    func placesPhotoSized(maxWidthPx: Int) -> URL {
        guard host?.contains("maps.googleapis.com") == true,
              var comps = URLComponents(url: self, resolvingAgainstBaseURL: false),
              var items = comps.queryItems,
              let idx = items.firstIndex(where: { $0.name == "maxwidth" })
        else { return self }
        items[idx].value = String(min(max(maxWidthPx, 200), 1000))
        comps.queryItems = items
        return comps.url ?? self
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

    /// Warm the cache for feed cover photos before they scroll into view, at
    /// the shared feed thumbnail size so the entry matches what the cards
    /// request. Fire-and-forget; de-duped and coalesced by `load`. Skips URLs
    /// already in memory so a refresh is nearly free. `nonisolated` (like
    /// `cached(for:)`) so the feed's load path can call it without awaiting —
    /// the actual fetch still hops onto the actor via `load`.
    nonisolated func prefetchThumbnails<S: Sequence>(_ rawURLs: S) where S.Element == String {
        let px = Int((FeedImage.thumbWidth * UIScreen.main.scale).rounded(.up))
        for raw in rawURLs {
            guard let url = URL(string: raw)?.placesPhotoSized(maxWidthPx: px) else { continue }
            if cached(for: url) != nil { continue }
            Task { _ = await load(url) }
        }
    }
}
