import SwiftUI

// The Color-facing half of the Wallet pass legibility rule. The arithmetic
// lives in PassContrastMath (Foundation-only, so it can be verified against
// the TypeScript); this only converts SwiftUI Colors and writes the sentences
// a promoter reads.
//
// It exists so the preview reacts to a colour drag immediately — a round-trip
// per frame is not a live preview. The SERVER remains the boundary: it re-runs
// the same check on write and rejects with a 422, so a client that drifts (or
// a hand-rolled request) cannot store an illegible pass.

enum PassContrast {
    static var valueMinRatio: Double { PassContrastMath.valueMinRatio }
    static var labelMinRatio: Double { PassContrastMath.labelMinRatio }

    static let ink   = Color(hex: 0x0A0807)
    static let cream = Color(hex: 0xFFF6E5)

    private static func rgb(_ color: Color) -> PassContrastMath.RGB {
        let (r, g, b) = color.srgbComponents
        return PassContrastMath.RGB(r * 255, g * 255, b * 255)
    }

    struct Check {
        let foreground: Color
        let valueRatio: Double
        let labelRatio: Double
        let problems: [String]
        var ok: Bool { problems.isEmpty }
    }

    /// A typeset wordmark's colour against the pass background.
    ///
    /// Held to the label threshold, not the value one: a wordmark is large
    /// display type and survives lower contrast than field text. It is still
    /// checked, because picking a brand colour without looking at your own
    /// background is exactly how a logo disappears. Mirrors checkLogoColor in
    /// src/lib/wallet/contrast.ts.
    static func logoProblem(background: Color, logo: Color) -> String? {
        let ratio = PassContrastMath.ratio(rgb(logo), rgb(background))
        guard ratio < PassContrastMath.labelMinRatio else { return nil }
        return String(
            format: "The wordmark colour is too close to the background to see (%.1f:1, needs %.1f:1).",
            ratio, PassContrastMath.labelMinRatio)
    }

    static func check(background: Color, accent: Color, logo: Color? = nil) -> Check {
        let m = PassContrastMath.check(background: rgb(background), accent: rgb(accent))
        var problems: [String] = []

        if !m.valueOK {
            problems.append(String(
                format: "This background is too mid-toned for text to read against — the best either light or dark type manages is %.1f:1, and %.1f:1 is the minimum. Go lighter or darker.",
                m.valueRatio, PassContrastMath.valueMinRatio))
        }
        if !m.labelOK {
            problems.append(String(
                format: "The accent is too close to the background to read as a label (%.1f:1, needs %.1f:1).",
                m.labelRatio, PassContrastMath.labelMinRatio))
        }

        if let logo, let problem = logoProblem(background: background, logo: logo) {
            problems.append(problem)
        }

        return Check(
            foreground: m.foreground == PassContrastMath.cream ? cream : ink,
            valueRatio: m.valueRatio,
            labelRatio: m.labelRatio,
            problems: problems)
    }
}
