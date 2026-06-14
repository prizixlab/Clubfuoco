import EventKit
import Foundation

/// Adds nightlife events to the user's calendar. Uses write-only access
/// (iOS 17+) — we only ever create events, never read the calendar, so the
/// system shows the lighter "add only" permission prompt.
enum CalendarService {
    enum CalendarError: LocalizedError {
        case accessDenied
        case noCalendar

        var errorDescription: String? {
            switch self {
            case .accessDenied: "Calendar access was not granted"
            case .noCalendar:   "No default calendar available"
            }
        }
    }

    /// Creates an event for a club night. The booking date is a plain
    /// `yyyy-MM-dd`, so we anchor doors at 23:00 local and run it four hours.
    static func addNightEvent(
        title: String,
        dateString: String,
        location: String?,
        notes: String?
    ) async throws {
        let store = EKEventStore()
        let granted = try await store.requestWriteOnlyAccessToEvents()
        guard granted else { throw CalendarError.accessDenied }
        guard let calendar = store.defaultCalendarForNewEvents else { throw CalendarError.noCalendar }

        let event = EKEvent(eventStore: store)
        event.title = title
        event.location = location
        event.notes = notes
        event.calendar = calendar
        event.startDate = doorsDate(from: dateString)
        event.endDate = event.startDate.addingTimeInterval(4 * 3600)

        try store.save(event, span: .thisEvent)
    }

    private static func doorsDate(from dateString: String) -> Date {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.timeZone = .current
        let base = parser.date(from: dateString) ?? Date()
        return Calendar.current.date(bySettingHour: 23, minute: 0, second: 0, of: base) ?? base
    }
}
