import Foundation
import Observation

/// Mirrors PlanContext: the "when are you going out" date set on Explore and
/// read by booking flows. Persisted under the web app's key ("cf-plan");
/// stale (past) dates fall back to today, and the booking window is capped
/// at 14 days ahead like the WhenPlanner / server guard.
@MainActor
@Observable
final class PlanStore {
    static let storageKey = "cf-plan"
    static let maxDaysAhead = 14

    var date: String {
        didSet { persist() }
    }

    init() {
        if let raw = UserDefaults.standard.string(forKey: Self.storageKey),
           let data = raw.data(using: .utf8),
           let stored = try? JSONDecoder().decode(StoredPlan.self, from: data),
           Self.isValid(stored.date) {
            date = stored.date
        } else {
            date = Self.today()
        }
    }

    private struct StoredPlan: Codable {
        let date: String
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(StoredPlan(date: date)),
           let raw = String(data: data, encoding: .utf8) {
            UserDefaults.standard.set(raw, forKey: Self.storageKey)
        }
    }

    static func today() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.string(from: Date())
    }

    /// Mirrors isValidPlanDate(): today through 14 days ahead.
    static func isValid(_ value: String) -> Bool {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        guard let picked = formatter.date(from: value) else { return false }
        let start = Calendar.current.startOfDay(for: Date())
        let days = Calendar.current.dateComponents([.day], from: start, to: picked).day ?? -1
        return days >= 0 && days <= maxDaysAhead
    }

    struct DayOption: Identifiable, Hashable {
        let value: String   // YYYY-MM-DD
        let label: String   // "Tonight" / "Sat 14 Jun"
        var id: String { value }
    }

    /// Mirrors buildDayOptions(): today → +14 days with localized labels.
    @MainActor
    static func dayOptions(locale: LocaleStore) -> [DayOption] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let value = DateFormatter()
        value.dateFormat = "yyyy-MM-dd"
        let label = DateFormatter()
        label.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        label.setLocalizedDateFormatFromTemplate("EEE d MMM")

        return (0...maxDaysAhead).map { offset in
            let day = calendar.date(byAdding: .day, value: offset, to: start)!
            let text: String
            switch offset {
            case 0: text = locale.t("plan.tonight")
            case 1: text = locale.t("plan.tomorrow")
            default: text = label.string(from: day)
            }
            return DayOption(value: value.string(from: day), label: text)
        }
    }

    /// Mirrors formatPlan(): the label for the currently planned date.
    @MainActor
    func formatted(locale: LocaleStore) -> String {
        Self.dayOptions(locale: locale).first { $0.value == date }?.label ?? date
    }

    /// A natural-language phrase for headlines that read "<phrase> with Rumba"
    /// or "<phrase>: Venue": "Tonight" / "Tomorrow" / "Saturday" / "Next Saturday".
    @MainActor
    func nightPhrase(locale: LocaleStore) -> String {
        let cal = Calendar.current
        let parse = DateFormatter()
        parse.dateFormat = "yyyy-MM-dd"
        parse.timeZone = .current
        guard let picked = parse.date(from: date) else { return locale.t("plan.tonight") }
        let start = cal.startOfDay(for: Date())
        let offset = cal.dateComponents([.day], from: start, to: cal.startOfDay(for: picked)).day ?? 0
        switch offset {
        case ..<1: return locale.t("plan.tonight")
        case 1:    return locale.t("plan.tomorrow")
        default:
            let weekday = DateFormatter()
            weekday.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
            weekday.setLocalizedDateFormatFromTemplate("EEEE")
            var name = weekday.string(from: picked)
            if offset >= 7 { name = "\(locale.t("plan.next")) \(name)" }
            return name.prefix(1).uppercased() + name.dropFirst()
        }
    }
}
