import Foundation
import SwiftUI
import UserNotifications
import UIKit

extension Notification.Name {
    /// Posted when a review-outcome push arrives (approve/reject of a night,
    /// series, or offer change). userInfo carries entity / id / decision /
    /// reason from the APNs payload.
    static let reviewOutcomeReceived = Notification.Name("cf.reviewOutcomeReceived")
}

/// Push foundation: permission prompt, APNs registration, token persistence,
/// and routing of review-outcome payloads to interested screens. Everything
/// here is best-effort — push failing (denied permission, unapplied
/// device_tokens migration, offline) never affects the rest of the app.
@MainActor
final class PushManager: NSObject, ObservableObject {
    static let shared = PushManager()

    /// Ask for permission and register with APNs. Called when the signed-in
    /// promoter UI appears (not at cold launch), so the prompt has context.
    /// Subsequent calls are cheap no-ops or silent re-registrations.
    func enable() {
        Task {
            let center = UNUserNotificationCenter.current()
            center.delegate = self
            let settings = await center.notificationSettings()
            switch settings.authorizationStatus {
            case .notDetermined:
                let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
                guard granted else { return }
            case .denied:
                return   // respect the user's choice; iOS Settings is the way back
            default:
                break    // already authorized (or provisional) — just refresh the token
            }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// APNs issued a device token — persist it against the signed-in user.
    func handleToken(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        // Debug builds on-device get sandbox APNs (aps-environment is
        // "development" until App Store/TestFlight signing rewrites it).
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        Task { await PromoterRepo().registerDeviceToken(hex, environment: environment) }
    }

    private func handlePayload(_ userInfo: [AnyHashable: Any]) {
        guard (userInfo["type"] as? String) == "review_outcome" else { return }
        NotificationCenter.default.post(name: .reviewOutcomeReceived, object: nil,
                                        userInfo: userInfo)
    }
}

extension PushManager: UNUserNotificationCenterDelegate {
    /// Foreground pushes still show as a banner, and review outcomes trigger
    /// an immediate data refresh on the visible screens.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        Task { @MainActor in self.handlePayload(userInfo) }
        completionHandler([.banner, .sound])
    }

    /// The user tapped the notification.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        Task { @MainActor in self.handlePayload(userInfo) }
        completionHandler()
    }
}
