import SwiftUI

/// Palette for the explore feed.
///
/// The dark values are a direct transcription of the design's `:root` block in
/// "Event Cards - App Front.html". The light values are the same design
/// system's own light palette — `.screen[data-palette="bone"]` in its
/// styles.css — which is not an invention: its values are identical to the
/// tokens the app already used here (`Theme.cream` / `ink` / `stone` /
/// `fadedSand`), so light mode reads as the app it always was, wearing the new
/// layout.
///
/// An earlier pass hard-coded the dark values on the grounds that the artboard
/// is dark. That took light mode away — and because the screen ALSO forced
/// `colorScheme` to `.dark`, the override rode the navigation stack into club
/// detail, rumba detail and shelf lists. Explore is the launch tab, so a
/// light-mode user effectively lost light mode. Tokens are adaptive now and
/// nothing forces the appearance.
///
/// Gold `#C09950` is the brand accent and the only "active" colour — it must
/// never drift warm enough to read pink (see the brand palette note on the
/// stale Rumbalist #FF2D92). It holds across both appearances: on cream it is
/// the brand's own light gold, and the design's dark artboard specifies the
/// same value.
enum Explore {
    // ── Surfaces ──────────────────────────────────────────────────────────────
    static let bg = Color.adaptive(light: 0xF8F5EE, dark: 0x0D0B08)        // --bg
    static let surface = Color.adaptive(light: 0xFFFFFF, dark: 0x171310)   // --surface
    static let surface2 = Color.adaptive(light: 0xF4EFE3, dark: 0x1E1811)  // --surface-2

    // ── Lines ─────────────────────────────────────────────────────────────────
    // Both are the ink colour at low alpha, exactly as the CSS writes them.
    static let line = Color.adaptive(light: 0x221E1A, lightAlpha: 0.08,
                                     dark: 0xF3E8D2, darkAlpha: 0.09)       // --line
    static let lineStrong = Color.adaptive(light: 0x221E1A, lightAlpha: 0.16,
                                           dark: 0xF3E8D2, darkAlpha: 0.18) // --line-strong

    // ── Ink ───────────────────────────────────────────────────────────────────
    static let ink = Color.adaptive(light: 0x221E1A, dark: 0xF3E8D2)   // --ink   primary text
    static let ink2 = Color.adaptive(light: 0x6E6356, dark: 0xA99B84)  // --ink-2 secondary text
    static let ink3 = Color.adaptive(light: 0x9F9486, dark: 0x6E6353)  // --ink-3 captions

    // ── Accent ────────────────────────────────────────────────────────────────
    // Gold in dark, wine in light — and that is the design system's own call,
    // not a compromise: its dark artboard sets `--gold: #C09950`, its light one
    // sets `--accent: #8C2A2A`. Wine is also what `Theme.accent` already
    // resolves to in light across the rest of the app, so a club page reached
    // from the feed keeps the same accent.
    //
    // The reason gold cannot simply carry over: it was picked against a
    // near-black ground. On cream it drops to ~2.5:1 contrast — below WCAG AA
    // for text — so "See all" and chip labels became genuinely hard to read in
    // daylight, on top of reading brown. Wine lands at ~9:1.
    static let accent = Color.adaptive(light: 0x8C2A2A, dark: 0xC09950)
    static let accentDim = Color.adaptive(light: 0x4A1313, dark: 0x8C6B32)
    static let accentSoft = Color.adaptive(light: 0x8C2A2A, lightAlpha: 0.07,
                                           dark: 0xC09950, darkAlpha: 0.13)

    /// `--ember`. Reserved for the live "open now" marker in BOTH appearances —
    /// it means something, so it never doubles as the accent.
    static let ember = Color.adaptive(light: 0xA8431F, dark: 0xC2562D)

    // ── On photography ────────────────────────────────────────────────────────
    // Text drawn OVER a photo is a separate problem from text on the page, and
    // must NOT follow the appearance. A photo under a dark scrim is dark in
    // both modes, so `ink` — near-black in light — put dark type on a dark
    // ground and the featured card's title all but disappeared in daylight.
    // These are fixed light values, and every over-image label uses them.
    static let onPhoto = Color(hex: 0xF3E8D2)
    static let onPhotoDim = Color(hex: 0xF3E8D2).opacity(0.82)

    /// Label colour on an accent fill. The dark design hard-codes `#1A1409`
    /// so its gold pills read as ink printed on foil; on wine the readable
    /// pairing is the page cream, which is what the app's ink/cream contrast
    /// pair already does.
    static let onAccent = Color.adaptive(light: 0xF8F5EE, dark: 0x1A1409)

    // ── Radii ─────────────────────────────────────────────────────────────────
    static let rCard: CGFloat = 18       // --r-card
    static let rThumb: CGFloat = 13      // --r-thumb
    static let rFeatured: CGFloat = 22   // .evt-featured
    static let rFeed: CGFloat = 16       // .evt-feed

    /// Gutter. Every horizontal edge in the design sits at 18, not the cream
    /// feed's 20.
    static let gutter: CGFloat = 18

    /// Behind a photo while it loads — a warm block a shade off the page so a
    /// slow image reads as a card, not a hole.
    static let photoPlaceholder = Color.adaptive(light: 0xEFE9DD, dark: 0x1E1811)
}

/// The film-grain overlay the design puts on every photo
/// (`.thumb-grain` — fractal-noise SVG at 50% opacity, `mix-blend-mode:
/// overlay`).
///
/// SwiftUI has no `feTurbulence`, so the noise is generated once into a small
/// tiling image and reused; regenerating per card showed up immediately when
/// scrolling a rail of them. `.blendMode(.overlay)` matches the CSS.
struct GrainOverlay: View {
    /// One 120×120 noise tile, matching the SVG filter's declared size.
    ///
    /// Two details of the CSS matter and were wrong in the first pass, which
    /// came out as heavy salt-and-pepper over every photo:
    ///
    /// 1. The filter's colour matrix zeroes R, G and B and scales alpha by 0.5
    ///    — so the grain is BLACK at varying alpha, not grey at flat alpha.
    ///    Grey noise at full alpha speckles bright and dark at once, which is
    ///    what produced the dithering.
    /// 2. `feTurbulence` is evaluated in device pixels. Tiling a 120-point
    ///    image blows each speck up to ~3 device pixels on a 3x screen, so the
    ///    tile is rendered at the screen's scale and tiled in pixels.
    private static let tile: UIImage = {
        let scale = max(UIScreen.main.scale, 1)
        let side = Int(120 * scale)
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        // Deterministic so the grain is identical on every launch and every
        // card — a per-launch random tile made screenshots differ run to run.
        var seed: UInt64 = 0x9E3779B97F4A7C15
        func next() -> UInt8 {
            seed ^= seed << 13
            seed ^= seed >> 7
            seed ^= seed << 17
            return UInt8(truncatingIfNeeded: seed >> 24)
        }
        for i in stride(from: 0, to: pixels.count, by: 4) {
            // Premultiplied black: RGB stay 0, only alpha carries the noise.
            pixels[i + 3] = next() / 2
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(
            data: &pixels, width: side, height: side, bitsPerComponent: 8,
            bytesPerRow: side * 4, space: cs,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
        guard let cg = ctx?.makeImage() else { return UIImage() }
        return UIImage(cgImage: cg, scale: scale, orientation: .up)
    }()

    var body: some View {
        Image(uiImage: Self.tile)
            .resizable(resizingMode: .tile)
            // The CSS stacks opacity .5 on top of the matrix's own .5. Kept
            // lower here: `overlay` against a near-black page darkens harder
            // than it does in the browser preview, and the point of the grain
            // is texture you feel rather than noise you read.
            .opacity(0.22)
            .blendMode(.overlay)
            .allowsHitTesting(false)
    }
}
