import ImageIO
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
            // Clear on every new URL: a reused view (one club's page swapped
            // for another's) otherwise kept the old photo whenever the new
            // one failed or was still loading — La Fira showing Opium.
            guard let url else { uiImage = nil; return }
            if let cached = ImageCache.shared.cached(for: url) {
                uiImage = cached
                return
            }
            uiImage = nil
            uiImage = await ImageCache.shared.load(url)
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
///
/// Downloads go through a small concurrency gate and retry transient failures.
/// Supabase Storage answers 429 once an IP has spent its request budget, and
/// on a carrier NAT that budget is shared with strangers; cellular drops and
/// timeouts are just as common at 3am outside a club. Before this, a 429's JSON
/// body simply failed to decode, any failure was final, and the card kept its
/// grey placeholder for the rest of the session.
actor ImageCache {
    static let shared = ImageCache()

    private static let maxConcurrent = 8
    private static let maxAttempts = 4

    private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]
    private var active = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

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

        let task = Task<UIImage?, Never> { await self.fetch(url) }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image { memory.setObject(image, forKey: url as NSURL) }
        return image
    }

    private func fetch(_ url: URL) async -> UIImage? {
        for attempt in 0..<Self.maxAttempts {
            await acquire()
            let result = try? await session.data(from: url)
            release()

            var retryAfter: Double?
            if let (data, response) = result {
                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? 200
                if (200..<300).contains(status) { return Self.decode(data) }
                // Only throttling and server errors can change on a retry; a
                // 404 or 400 (e.g. an expired Google photo reference) won't.
                guard status == 429 || status >= 500 else { return nil }
                retryAfter = http?.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
            }
            // A failed transport (result == nil) falls through and retries too.
            guard attempt < Self.maxAttempts - 1 else { break }
            let backoff = retryAfter ?? 0.5 * pow(2, Double(attempt))
            let jitter = Double.random(in: 0...0.4)
            try? await Task.sleep(for: .seconds(min(backoff, 5) + jitter))
        }
        return nil
    }

    /// Decodes straight to at most `maxDecodePx` on the long side. Some
    /// uploaded covers are camera originals (Bar Los Amigos is 39 MB), and a
    /// full decode of those costs hundreds of MB of bitmap for a 220pt card.
    private static let maxDecodePx = 2000

    private static func decode(_ data: Data) -> UIImage? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options) else { return nil }
        let thumbOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxDecodePx,
        ] as CFDictionary
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions) else {
            return UIImage(data: data)
        }
        return UIImage(cgImage: cg)
    }

    private func acquire() async {
        if active < Self.maxConcurrent {
            active += 1
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    /// Hands the slot straight to the next waiter, so `active` only drops
    /// when nobody is queued.
    private func release() {
        if waiters.isEmpty {
            active -= 1
        } else {
            waiters.removeFirst().resume()
        }
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
