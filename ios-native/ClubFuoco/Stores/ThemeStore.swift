import SwiftUI
import Observation

/// Appearance preference — Light / Dark / System — persisted under "cf-theme"
/// and applied at the app root via `.preferredColorScheme`. Mirrors the shape
/// of `LocaleStore` (same `@Observable` + UserDefaults pattern).
@MainActor
@Observable
final class ThemeStore {
    enum Setting: String, CaseIterable {
        case system, light, dark
    }

    static let storageKey = "cf-theme"

    var setting: Setting {
        didSet { UserDefaults.standard.set(setting.rawValue, forKey: Self.storageKey) }
    }

    /// nil = follow the system setting.
    var colorScheme: ColorScheme? {
        switch setting {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }

    init() {
        let stored = UserDefaults.standard.string(forKey: Self.storageKey)
        // Follow the device. Anyone who already picked Light or Dark in
        // Settings keeps their choice — only installs with no stored value
        // (fresh, or never opened the picker) inherit the system setting.
        self.setting = Setting(rawValue: stored ?? "") ?? .system
    }
}
