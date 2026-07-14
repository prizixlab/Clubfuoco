import SwiftUI
import UIKit

/// Fullscreen photo viewer for the club page — opened by tapping the hero or
/// any thumbnail in the photos strip. Swipe to page through every photo,
/// pinch or double-tap to zoom (native UIScrollView zooming).
struct PhotoViewer: View {
    let photos: [String]
    let startIndex: Int
    @Environment(\.dismiss) private var dismiss
    @State private var index: Int

    init(photos: [String], startIndex: Int) {
        self.photos = photos
        self.startIndex = startIndex
        _index = State(initialValue: min(max(startIndex, 0), max(photos.count - 1, 0)))
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()

            // UIPageViewController, not SwiftUI's paged TabView — the TabView
            // snap animation is noticeably slow/floaty for a photo browser,
            // and it can't put a gap between pages.
            PhotoPager(photos: photos, index: $index)
                .ignoresSafeArea()

            HStack {
                if photos.count > 1 {
                    Text("\(index + 1) / \(photos.count)")
                        .font(.cfMono(12))
                        .kerning(1)
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.black.opacity(0.4), in: .capsule)
                }
                Spacer()
                Button {
                    Haptics.tap()
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .frame(width: 38, height: 38)
                        .background(.black.opacity(0.4), in: .circle)
                        .overlay(Circle().stroke(.white.opacity(0.12)))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
    }
}

// ── Pager ─────────────────────────────────────────────────────────────────────

/// Horizontal photo pager backed by UIPageViewController (.scroll): snappy
/// interactive swipes, 16pt gap between photos, and automatic preloading of
/// the neighbouring page so the next image is decoded before it's on screen.
private struct PhotoPager: UIViewControllerRepresentable {
    let photos: [String]
    @Binding var index: Int

    func makeUIViewController(context: Context) -> UIPageViewController {
        let pager = UIPageViewController(
            transitionStyle: .scroll,
            navigationOrientation: .horizontal,
            options: [.interPageSpacing: 16]
        )
        pager.dataSource = context.coordinator
        pager.delegate = context.coordinator
        pager.view.backgroundColor = .clear
        pager.setViewControllers(
            [context.coordinator.page(at: index)], direction: .forward, animated: false
        )
        return pager
    }

    func updateUIViewController(_ pager: UIPageViewController, context: Context) {
        // Keep the binding fresh — the coordinator captured the struct by value.
        context.coordinator.parent = self
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: PhotoPager
        private var pages: [Int: UIViewController] = [:]

        init(_ parent: PhotoPager) { self.parent = parent }

        func page(at i: Int) -> UIViewController {
            if let existing = pages[i] { return existing }
            let host = UIHostingController(rootView: ZoomablePhotoPage(url: parent.photos[i]))
            host.view.backgroundColor = .clear
            host.view.tag = i   // page index rides on the root view's tag
            pages[i] = host
            return host
        }

        func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController) -> UIViewController? {
            let i = viewController.view.tag
            return i > 0 ? page(at: i - 1) : nil
        }

        func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController) -> UIViewController? {
            let i = viewController.view.tag
            return i < parent.photos.count - 1 ? page(at: i + 1) : nil
        }

        func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool, previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
            guard completed, let current = pageViewController.viewControllers?.first else { return }
            parent.index = current.view.tag
        }
    }
}

// ── Single page ───────────────────────────────────────────────────────────────

/// One page: loads the image through the shared ImageCache, then hands it to
/// the UIScrollView-backed zoom view.
private struct ZoomablePhotoPage: View {
    let url: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                ZoomableImageView(image: image)
            } else {
                ProgressView()
                    .tint(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: url) {
            guard let parsed = URL(string: url) else { return }
            if let cached = ImageCache.shared.cached(for: parsed) {
                image = cached
                return
            }
            image = await ImageCache.shared.load(parsed)
        }
    }
}

/// Native pinch-zoom / pan via UIScrollView — SwiftUI gesture reimplementations
/// never match UIKit's rubber-banding and anchoring, so don't try.
private struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.bouncesZoom = true
        scroll.backgroundColor = .clear
        scroll.delegate = context.coordinator

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scroll.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        imageView.isUserInteractionEnabled = true
        scroll.addSubview(imageView)
        context.coordinator.imageView = imageView

        let doubleTap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleDoubleTap(_:))
        )
        doubleTap.numberOfTapsRequired = 2
        imageView.addGestureRecognizer(doubleTap)

        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
            guard let imageView, let scroll = imageView.superview as? UIScrollView else { return }
            if scroll.zoomScale > 1.01 {
                scroll.setZoomScale(1, animated: true)
            } else {
                // Zoom in around the tapped point.
                let point = gesture.location(in: imageView)
                let size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
                let rect = CGRect(
                    x: point.x - size.width / 2, y: point.y - size.height / 2,
                    width: size.width, height: size.height
                )
                scroll.zoom(to: rect, animated: true)
            }
        }
    }
}
