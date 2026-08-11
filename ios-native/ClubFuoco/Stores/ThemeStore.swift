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
        // Default to Light: the palette is light-first and the dark sweep is
        // opt-in until every screen has been verified.
        self.setting = Setting(rawValue: stored ?? "") ?? .light
    }
}
