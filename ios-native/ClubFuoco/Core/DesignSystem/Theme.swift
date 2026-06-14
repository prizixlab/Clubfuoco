import SwiftUI

/// Design tokens lifted from the web app's inline palette
/// (BottomNav.tsx / OAuthButtons.tsx / globals.css).
enum Theme {
    // ── Colors ────────────────────────────────────────────────────────────────
    static let ink = Color(hex: 0x221E1A)        // primary text / dark surfaces
    static let stone = Color(hex: 0x6E6356)      // secondary text
    static let sand = Color(hex: 0xB0A898)       // inactive / tertiary
    static let fadedSand = Color(hex: 0x9F9486)  // captions, overlines
    static let cream = Color(hex: 0xF8F5EE)      // app background
    static let gold = Color(hex: 0xC09950)       // accent (active pill, highlights)
    static let wine = Color(hex: 0x8C2A2A)       // badges / destructive accents

    static let hairline = Color(hex: 0x221E1A).opacity(0.10)

    // Night/cinema palette (splash + dark hero surfaces, see Splash.tsx)
    static let night = Color(hex: 0x0A0807)         // rgb(10,8,7)
    static let parchment = Color(hex: 0xF4ECDD)     // rgb(244,236,221)
    static let ember = Color(hex: 0xC2562D)         // rgb(194,86,45) primary CTA
    static let emberCream = Color(hex: 0xFFF6E5)    // rgb(255,246,229)
    static let flame = Color(hex: 0xE8B65B)         // rgb(232,182,91) glow/badges
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
