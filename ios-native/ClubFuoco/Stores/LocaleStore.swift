import Foundation
import Observation

/// Mirrors LocaleContext: en / es with a "device" auto option, persisted
/// under the same key name the web app uses in localStorage ("cf-locale").
/// Strings resolve through the matching .lproj bundle so the in-app language
/// switch takes effect immediately, without relaunching.
@MainActor
@Observable
final class LocaleStore {
    enum Setting: String, CaseIterable {
        case en, es, ca, fr, device
    }

    static let storageKey = "cf-locale"

    var setting: Setting {
        didSet {
            UserDefaults.standard.set(setting.rawValue, forKey: Self.storageKey)
            locale = Self.resolve(setting)
        }
    }
    private(set) var locale: String

    init() {
        let stored = UserDefaults.standard.string(forKey: Self.storageKey)
        // Default to English on a fresh install (the web app auto-detects the
        // device language, but the native app ships English-first). Users can
        // switch to Spanish or device-language in Settings.
        let initial = Setting(rawValue: stored ?? "") ?? .en
        self.setting = initial
        self.locale = Self.resolve(initial)
    }

    /// Mirrors detectDeviceLocale(): first preferred language that is Catalan,
    /// Spanish or French wins (in device order), otherwise English.
    private static func resolve(_ setting: Setting) -> String {
        switch setting {
        case .en, .es, .ca, .fr:
            return setting.rawValue
        case .device:
            for lang in Locale.preferredLanguages {
                if lang.hasPrefix("ca") { return "ca" }
                if lang.hasPrefix("es") { return "es" }
                if lang.hasPrefix("fr") { return "fr" }
            }
            return "en"
        }
    }

    /// Mirrors t(): look up in the active locale, fall back to English, then
    /// to the key itself.
    func t(_ key: String) -> String {
        if let bundle = Self.bundle(for: locale) {
            let value = bundle.localizedString(forKey: key, value: nil, table: nil)
            if value != key { return value }
        }
        if locale != "en", let en = Self.bundle(for: "en") {
            let value = en.localizedString(forKey: key, value: nil, table: nil)
            if value != key { return value }
        }
        return key
    }

    private static func bundle(for locale: String) -> Bundle? {
        guard let path = Bundle.main.path(forResource: locale, ofType: "lproj") else { return nil }
        return Bundle(path: path)
    }
}
