import Foundation
import UserNotifications

/// Delegate that opts our app's notifications in to show as a banner even
/// while the app is foregrounded, and forwards notification taps as a
/// `Notification.Name.cfMorningAfterTapped` carrying the booking id so any
/// SwiftUI view can react without owning the UNUserNotificationCenter API.
@MainActor
final class NotificationForegroundDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationForegroundDelegate()

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        if let raw = info["bookingId"] as? String, let id = UUID(uuidString: raw) {
            NotificationCenter.default.post(
                name: .cfMorningAfterTapped,
                object: nil,
                userInfo: ["bookingId": id]
            )
        } else if info["kind"] as? String == "morning_after_test" {
            NotificationCenter.default.post(name: .cfMorningAfterTapped, object: nil)
        }
        completionHandler()
    }
}

extension Notification.Name {
    static let cfMorningAfterTapped = Notification.Name("cf.morning-after.tapped")
}

/// Local "morning after" notifications for attendance verification.
///
/// At 10:00 Madrid-local on the day AFTER each booking, the device fires
/// a local notification asking "Did you get in?" — tapping it opens the
/// app and the user lands on the booking detail's post-entry prompt
/// (`AttendanceCheckInCard` in its `.postWindow` phase).
///
/// Local, not remote: no server push, no APNs token, no extra entitlement.
/// We sync the schedule whenever bookings reload, so cancellations and new
/// bookings stay in line.
@MainActor
final class NotificationService {
    static let shared = NotificationService()

    private static let prefix = "cf.morning-after."
    private static let venueTimeZone = TimeZone(identifier: "Europe/Madrid") ?? .current

    /// Ask the OS for permission. Returns true if granted (now or earlier).
    /// Silently no-ops if denied — caller stays unaware.
    func ensureAuthorized() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .denied: return false
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        @unknown default: return false
        }
    }

    /// Reconcile pending notifications with the current booking list. Idempotent:
    /// safe to call after every `BookingsModel.load()` — duplicates collapse
    /// because we key by booking id.
    func syncMorningAfter(for bookings: [Booking]) async {
        guard await ensureAuthorized() else { return }
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        let pendingIds = Set(pending.map(\.identifier))
        let now = Date()

        var keep = Set<String>()

        for booking in bookings {
            let nid = Self.id(for: booking)
            // Cancel + skip when the booking can't / shouldn't notify any more.
            let suppress = booking.status == "cancelled"
                || Self.isResolved(booking.attendanceStatus)
            guard !suppress, let fire = Self.morningAfter(for: booking), fire > now else {
                if pendingIds.contains(nid) {
                    center.removePendingNotificationRequests(withIdentifiers: [nid])
                }
                continue
            }
            keep.insert(nid)
            // Already scheduled? Leave it — the trigger date hasn't changed.
            if pendingIds.contains(nid) { continue }

            let content = UNMutableNotificationContent()
            content.title = "Did you get in last night?"
            content.body  = "Tell us how it went at \(booking.club?.name ?? "the venue")."
            content.sound = .default
            content.userInfo = [
                "bookingId": booking.id.uuidString.lowercased(),
                "kind": "morning_after",
            ]

            var dc = Calendar.current.dateComponents(in: Self.venueTimeZone, from: fire)
            dc.timeZone = Self.venueTimeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: dc, repeats: false)
            let req = UNNotificationRequest(identifier: nid, content: content, trigger: trigger)
            try? await center.add(req)
        }

        // Drop notifications for bookings that have disappeared from the list.
        let stale = pendingIds.filter { $0.hasPrefix(Self.prefix) && !keep.contains($0) }
        if !stale.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: Array(stale))
        }
    }

    func cancel(bookingId: UUID) {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [Self.id(for: bookingId)])
    }

    // ── DEBUG helper ─────────────────────────────────────────────────────────
    //
    // Used by `CF_TEST_MORNING_AFTER=1` at launch — schedules a single test
    // fire 15s out for the first upcoming booking so the morning-after copy
    // can be tested on demand without waiting for actual 10 AM next day.

    #if DEBUG
    /// Fires a generic morning-after notification with no booking attached —
    /// the fallback path when the test launcher can't find one to use.
    func debugFireStatic(seconds: TimeInterval = 15) async {
        guard await ensureAuthorized() else {
            NSLog("CF_TEST static notification: permission not granted")
            return
        }
        let content = UNMutableNotificationContent()
        content.title = "Did you get in last night?"
        content.body  = "Tell us how it went."
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(seconds, 5), repeats: false)
        let req = UNNotificationRequest(
            identifier: "cf.morning-after-test.static",
            content: content, trigger: trigger
        )
        do {
            try await UNUserNotificationCenter.current().add(req)
            NSLog("CF_TEST static notification scheduled in %.0fs", seconds)
        } catch {
            NSLog("CF_TEST static notification ADD failed: %@", String(describing: error))
        }
    }

    func debugScheduleSoon(for booking: Booking, seconds: TimeInterval = 15) async {
        guard await ensureAuthorized() else {
            NSLog("CF_TEST notification permission not granted")
            return
        }
        let content = UNMutableNotificationContent()
        content.title = "Did you get in last night?"
        content.body  = "Tell us how it went at \(booking.club?.name ?? "the venue")."
        content.sound = .default
        content.userInfo = [
            "bookingId": booking.id.uuidString.lowercased(),
            "kind": "morning_after_test",
        ]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(seconds, 5), repeats: false)
        let req = UNNotificationRequest(
            identifier: "cf.morning-after-test.\(booking.id.uuidString.lowercased())",
            content: content,
            trigger: trigger
        )
        try? await UNUserNotificationCenter.current().add(req)
        NSLog("CF_TEST scheduled morning-after notification in %.0fs for booking %@",
              seconds, booking.id.uuidString)
    }
    #endif

    // ── Date math ────────────────────────────────────────────────────────────

    private static func id(for booking: Booking) -> String {
        id(for: booking.id)
    }
    private static func id(for bookingId: UUID) -> String {
        "\(prefix)\(bookingId.uuidString.lowercased())"
    }

    /// 10:00 venue-local the day AFTER `booking.booking_date`. Returns nil if
    /// the date can't be parsed (shouldn't happen — server enforces ISO).
    private static func morningAfter(for booking: Booking) -> Date? {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = venueTimeZone
        guard let bookingDate = fmt.date(from: booking.bookingDate) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = venueTimeZone
        guard let nextDay = cal.date(byAdding: .day, value: 1, to: bookingDate) else { return nil }
        return cal.date(bySettingHour: 10, minute: 0, second: 0, of: nextDay)
    }

    private static func isResolved(_ status: String?) -> Bool {
        switch status {
        case "verified_attended", "likely_attended", "user_claimed_attended",
             "no_show", "disputed":
            return true
        default:
            return false
        }
    }
}
