import Foundation

// The numeric core of the Wallet pass legibility rule — the Swift half of a
// pair. The other half is src/lib/wallet/contrast.ts, and the two MUST agree:
// the app blocks Save on this one, the server rejects the write on that one,
// and a promoter hitting a disagreement gets a Save button that does nothing.
//
// Deliberately Foundation-only, with no SwiftUI and no Color: that keeps it
// compilable outside the app, so scripts/verify-pass-contrast.sh can run THIS
// file against fixtures generated from the TypeScript rather than against a
// copy of it that has quietly drifted.

enum PassContrastMath {
    /// Minimum contrast for field VALUES — the guest name, the date, the venue.
    static let valueMinRatio = 4.5
    /// Minimum for field LABELS, which are smaller and less critical.
    static let labelMinRatio = 3.0

    /// 0…255 per channel.
    struct RGB: Equatable {
        let r: Double, g: Double, b: Double
        init(_ r: Double, _ g: Double, _ b: Double) { self.r = r; self.g = g; self.b = b }
    }

    /// The only two candidate value colours: house ink and house cream. Not
    /// pure black/white, so a default theme renders the pass we already ship.
    static let ink   = RGB(10, 8, 7)        // #0A0807
    static let cream = RGB(255, 246, 229)   // #FFF6E5

    /// WCAG relative luminance, 0…1.
    static func relativeLuminance(_ c: RGB) -> Double {
        func channel(_ v: Double) -> Double {
            let s = v / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    /// WCAG contrast ratio, 1…21. Order-independent.
    static func ratio(_ a: RGB, _ b: RGB) -> Double {
        let la = relativeLuminance(a), lb = relativeLuminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// The value colour for a background. Never the promoter's choice: for a
    /// given background there is exactly one legible answer.
    static func readableForeground(on background: RGB) -> RGB {
        ratio(cream, background) >= ratio(ink, background) ? cream : ink
    }

    struct Check {
        let foreground: RGB
        let valueRatio: Double
        let labelRatio: Double
        var valueOK: Bool { valueRatio >= valueMinRatio }
        var labelOK: Bool { labelRatio >= labelMinRatio }
        var ok: Bool { valueOK && labelOK }
    }

    static func check(background: RGB, accent: RGB) -> Check {
        let fg = readableForeground(on: background)
        return Check(foreground: fg,
                     valueRatio: ratio(fg, background),
                     labelRatio: ratio(accent, background))
    }
}
