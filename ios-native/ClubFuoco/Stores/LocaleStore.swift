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
        // No choice made yet → follow the phone: its language when we have it,
        // English when we don't. A language picked in Settings is stored and
        // always wins.
        let initial = Setting(rawValue: stored ?? "") ?? .device
        self.setting = initial
        self.locale = Self.resolve(initial)
    }

    /// The phone's language if the app has it, else English. Walks the
    /// preferred languages IN ORDER and stops at the first one we support —
    /// English included — so an English phone with Spanish as a second
    /// language stays English (the old loop skipped English and picked es).
    private static func resolve(_ setting: Setting) -> String {
        switch setting {
        case .en, .es, .ca, .fr:
            return setting.rawValue
        case .device:
            for lang in Locale.preferredLanguages {
                let code = String(lang.prefix(2)).lowercased()
                if ["en", "es", "ca", "fr"].contains(code) { return code }
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
