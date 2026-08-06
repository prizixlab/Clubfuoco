import SwiftUI

/// Shared brand system — kept in sync with ios-promoters/…/Theme.swift.
/// Accent is gold #C09950; NEVER pink. Verdict colours are door-specific.
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

    // Verdict palette — must read in the dark at a crowded door.
    static let admit = Color(hex: 0x2E7D4F)      // green
    static let admitBright = Color(hex: 0x3FBE73)
    static let over = Color(hex: 0xC7902B)       // amber
    static let deny = Color(hex: 0xB23A3A)       // red

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
    init?(hexString: String) {
        let s = hexString.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(hex: v)
    }
}

enum Haptics {
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "cf.haptics.enabled") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "cf.haptics.enabled") }
    }
    @MainActor static func tap() { guard enabled else { return }; UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    @MainActor static func heavy() { guard enabled else { return }; UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    @MainActor static func success() { guard enabled else { return }; UINotificationFeedbackGenerator().notificationOccurred(.success) }
    @MainActor static func warning() { guard enabled else { return }; UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    @MainActor static func error() { guard enabled else { return }; UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

struct EmberPillButton: View {
    let title: String
    var loading: Bool = false
    var trailingIcon: String? = nil
    let action: () -> Void
    var body: some View {
        Button(action: { Haptics.tap(); action() }) {
            ZStack {
                Capsule().fill(Theme.ember)
                if loading {
                    ProgressView().tint(Theme.emberCream)
                } else {
                    HStack(spacing: 8) {
                        Text(title).font(.cfSans(15, weight: .semibold)).tracking(0.5)
                        if let trailingIcon {
                            Image(systemName: trailingIcon).font(.system(size: 13, weight: .semibold))
                        }
                    }
                    .foregroundStyle(Theme.emberCream)
                }
            }
            .frame(height: 54)
        }
        .disabled(loading)
    }
}
