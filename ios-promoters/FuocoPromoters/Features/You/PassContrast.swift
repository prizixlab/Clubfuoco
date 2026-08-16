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

    static func check(background: Color, accent: Color) -> Check {
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

        return Check(
            foreground: m.foreground == PassContrastMath.cream ? cream : ink,
            valueRatio: m.valueRatio,
            labelRatio: m.labelRatio,
            problems: problems)
    }
}
