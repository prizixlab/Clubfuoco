import SwiftUI

/// Design tokens lifted from the web app's inline palette
/// (BottomNav.tsx / OAuthButtons.tsx / globals.css).
enum Theme {
    // ── Colors ────────────────────────────────────────────────────────────────
    // `ink` and `cream` are a contrast *pair*: ink is the primary text color and
    // also the fill of the primary buttons/pills, whose labels are always
    // `cream`. Because both invert together, those filled controls flip to a
    // light-on-dark button in Dark Mode with no call-site change.
    static let ink = Color.adaptive(light: 0x221E1A, dark: 0xEDE6D8)       // primary text / contrast fills
    static let stone = Color.adaptive(light: 0x6E6356, dark: 0xB4AA9A)     // secondary text
    static let sand = Color.adaptive(light: 0xB0A898, dark: 0x7A7264)      // inactive / tertiary
    static let fadedSand = Color.adaptive(light: 0x9F9486, dark: 0x8A8172) // captions, overlines
    static let cream = Color.adaptive(light: 0xF8F5EE, dark: 0x0E0C0A)     // app background / labels on ink
    // The Dark variants of the three warm accents are deepened in *value* but
    // pushed UP in saturation. Scaling the RGB down uniformly (the obvious
    // move) drags them toward tan and brick — the reason the first pass read
    // as light yellow rather than gold. Held around hue 42° / S 0.82, they stay
    // metallic as they darken.
    //   gold  #C09950 (H39 S.58 V.75) -> #AD8420 (H42 S.82 V.68), 5.6:1
    static let gold = Color.adaptive(light: 0xC09950, dark: 0xAD8420)      // accent (active pill, highlights)
    // Same correction as the golds: the first dark value lifted brightness
    // without saturation and came out coral. #B33F38 holds the red hue at S .69
    // instead of .60 and drops V .78 -> .70, so it reads as wine again.
    static let wine = Color.adaptive(light: 0x8C2A2A, dark: 0xB33F38)      // badges / destructive accents

    static let hairline = Color.adaptive(light: 0x221E1A, lightAlpha: 0.10,
                                         dark: 0xF4ECDD, darkAlpha: 0.12)

    // ── Surfaces ──────────────────────────────────────────────────────────────
    // Cards and sheets that sit *on top of* the app background. In light these
    // are the plain white the app has always used; in dark they are a step
    // lighter than the background so elevation still reads.
    static let surface = Color.adaptive(light: 0xFFFFFF, dark: 0x1A1613)
    static let surfaceRaised = Color.adaptive(light: 0xFFFFFF, dark: 0x232019)

    /// Behind async images while they load — a warm block that matches the
    /// surrounding page rather than flashing light on a dark screen.
    static let imagePlaceholder = Color.adaptive(light: 0xEFE9DD, dark: 0x231F1A)

    /// "Open now", confirmed bookings, credited fiamme. Lightened in Dark so it
    /// still separates from the background.
    static let success = Color.adaptive(light: 0x2D7A46, dark: 0x4CA96B)

    /// QR cards stay white with dark modules in BOTH modes — door scanners
    /// need the quiet zone, so these must never follow the appearance.
    static let qrSurface = Color.white
    static let onQRSurface = Color(hex: 0x221E1A)

    // Night/cinema palette (splash + dark hero surfaces, see Splash.tsx).
    // Deliberately *not* adaptive — these surfaces are dark in both modes.
    static let night = Color(hex: 0x0A0807)         // rgb(10,8,7)
    static let parchment = Color(hex: 0xF4ECDD)     // rgb(244,236,221)
    //   ember #C2562D (H17 S.77 V.76) -> #B8431A (H16 S.86 V.72), 3.5:1
    // Saturation up rather than value down, so it lands bolder instead of
    // muddy — an orange that still has bite against the near-black page.
    static let ember = Color.adaptive(light: 0xC2562D, dark: 0xB8431A) // primary CTA
    static let emberCream = Color(hex: 0xFFF6E5)    // rgb(255,246,229)
    //   flame #E8B65B (H39 S.61 V.91) -> #C79426 (H41 S.81 V.78), 7.0:1
    static let flame = Color.adaptive(light: 0xE8B65B, dark: 0xC79426) // glow/badges

    /// The rating star over photo cards. Was two near-identical lemon yellows
    /// (0xF0C040 / 0xF5C142) that read as highlighter rather than gold; this is
    /// the same brightness at H43 / S.87. Fixed in both modes — it sits on a
    /// scrim over a photo, which is dark either way.
    static let starGold = Color(hex: 0xE0A81E)
    static let darkRed = Color(hex: 0x6B1F1F)       // rgb(107,31,31)

    // ── Radii ─────────────────────────────────────────────────────────────────
    static let radiusField: CGFloat = 14
    static let radiusCard: CGFloat = 18
    static let radiusPill: CGFloat = 24
}

// ── Typography ────────────────────────────────────────────────────────────────
// The brand fonts, matching the web app exactly: Instrument Serif (display)
// + Geist Sans (body) + Geist Mono (kickers/labels), bundled under
// ClubFuoco/Fonts and registered via UIAppFonts in project.yml.
//
// Geist's Medium / SemiBold faces ship as their own font families, so weights
// are referenced by exact PostScript name. Instrument Serif's Regular + Italic
// share one family, so `.italic()` (here and at call sites) resolves to the
// real italic face. `fixedSize:` keeps the same non-scaling sizing the layout
// was built against (matching the previous `.system(size:)`).
extension Font {
    static func cfSerif(_ size: CGFloat, italic: Bool = false) -> Font {
        let base = Font.custom("Instrument Serif", fixedSize: size)
        return italic ? base.italic() : base
    }
    static func cfMono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom(weight == .regular ? "GeistMono-Regular" : "GeistMono-Medium", fixedSize: size)
    }
    static func cfSans(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .medium:                 name = "Geist-Medium"
        case .semibold:               name = "Geist-SemiBold"
        case .bold, .heavy, .black:   name = "Geist-Bold"
        default:                      name = "Geist-Regular"
        }
        return Font.custom(name, fixedSize: size)
    }
}

/// Small uppercase monospaced overline ("kicker") used across the brand.
struct Kicker: View {
    let text: String
    var color: Color = Theme.wine
    var size: CGFloat = 9.5

    init(_ text: String, color: Color = Theme.wine, size: CGFloat = 9.5) {
        self.text = text
        self.color = color
        self.size = size
    }

    var body: some View {
        Text(text.uppercased())
            .font(.cfMono(size))
            .kerning(2.0)
            .foregroundStyle(color)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    /// A color that resolves per trait collection, so the ~850 `Theme.*` call
    /// sites need no change when Dark Mode flips. Built on a dynamic `UIColor`
    /// because SwiftUI has no first-class light/dark literal outside an asset
    /// catalog.
    static func adaptive(light: UInt32, lightAlpha: Double = 1,
                         dark: UInt32, darkAlpha: Double = 1) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark, alpha: darkAlpha)
                : UIColor(hex: light, alpha: lightAlpha)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32, alpha: Double) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: CGFloat(alpha)
        )
    }
}

/// Haptics on key actions — part of the "feels native" goal.
enum Haptics {
    @MainActor static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
    @MainActor static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
    @MainActor static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}
