import SwiftUI

enum Theme {
    static let night = Color(hex: 0x0A0807)
    static let nightLift = Color(hex: 0x15110E)
    static let parchment = Color(hex: 0xF4ECDD)
    static let parchmentDim = Color(hex: 0xF4ECDD).opacity(0.60)
    static let parchmentFaint = Color(hex: 0xF4ECDD).opacity(0.20)
    static let ember = Color(hex: 0xC2562D)
    static let emberCream = Color(hex: 0xFFF6E5)
    static let flame = Color(hex: 0xE8B65B)
    static let gold = Color(hex: 0xC09950)
    static let wine = Color(hex: 0x8C2A2A)
    static let hairline = Color(hex: 0xF4ECDD).opacity(0.10)

    static let radiusField: CGFloat = 14
    static let radiusCard: CGFloat = 18
    static let radiusPill: CGFloat = 28
}

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

struct Kicker: View {
    let text: String
    var color: Color = Theme.flame
    var size: CGFloat = 10
    init(_ text: String, color: Color = Theme.flame, size: CGFloat = 10) {
        self.text = text; self.color = color; self.size = size
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

enum Haptics {
    @MainActor static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    @MainActor static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

struct EmberPillButton: View {
    let title: String
    var loading: Bool = false
    let action: () -> Void
    var body: some View {
        Button(action: { Haptics.tap(); action() }) {
            ZStack {
                Capsule().fill(Theme.ember)
                if loading {
                    ProgressView().tint(Theme.emberCream)
                } else {
                    Text(title)
                        .font(.cfSans(15, weight: .semibold))
                        .foregroundStyle(Theme.emberCream)
                }
            }
            .frame(height: 52)
        }
        .disabled(loading)
    }
}
