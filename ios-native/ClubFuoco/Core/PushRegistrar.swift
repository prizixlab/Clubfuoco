import SwiftUI
import UIKit

/// Remote-push registration for the consumer app — the counterpart of the
/// promoter app's PushManager.
///
/// SwiftUI has no hook for `didRegisterForRemoteNotificationsWithDeviceToken`,
/// so an app delegate is adopted purely to receive that callback. Everything is
/// best-effort: a failure anywhere (no entitlement, no APNs key, device_tokens
/// missing, offline) leaves the rest of the app untouched — the in-app
/// notifications list is the durable record, push is delivery on top of it.
///
/// The token is stored per (user, app) so the server can address the right
/// bundle: APNs rejects a push whose topic isn't the bundle that owns the
/// token, so consumer and promoter tokens must never be mixed.
@MainActor
final class PushRegistrar {
    static let shared = PushRegistrar()

    /// Set by AppEnvironment once the Supabase service exists.
    var supabase: SupabaseService?

    private var lastUploadedToken: String?

    /// Ask iOS for an APNs token — only meaningful once the user has already
    /// granted notification permission, so callers gate on that. Cheap and
    /// idempotent: iOS returns the existing token when there is one.
    func registerIfAuthorized() async {
        guard await NotificationService.shared.isAuthorized() else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// APNs handed us a token. Upload it against the signed-in user.
    func handle(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        // Debug builds on device get sandbox APNs (the entitlement is
        // `development`); TestFlight/App Store builds get production. Sending
        // to the wrong host is a hard APNs failure, so it is recorded per token.
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        Task { await upload(token: hex, environment: environment) }
    }

    private func upload(token: String, environment: String) async {
        guard let supabase, token != lastUploadedToken else { return }
        guard let session = await supabase.currentSession() else { return }

        struct Row: Encodable {
            let userId: String
            let token: String
            let platform: String
            let app: String
            let environment: String
            let updatedAt: String
        }
        let row = Row(
            userId: session.user.id.uuidString,
            token: token,
            platform: "ios",
            app: "clubfuoco",              // must match device_tokens.app on the server
            environment: environment,
            updatedAt: ISO8601DateFormatter().string(from: Date()))

        do {
            try await supabase.client
                .from("device_tokens")
                .upsert(row, onConflict: "token")
                .execute()
            lastUploadedToken = token
        } catch {
            // Never surfaced: push is an enhancement, not a requirement.
        }
    }

    /// Forget the cached token so the next registration re-uploads it — called
    /// on sign-out/sign-in so a device that changes hands re-binds to the new
    /// user rather than silently keeping the previous owner's row.
    func reset() { lastUploadedToken = nil }
}

/// Adopted solely to receive the APNs token callback.
final class PushAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // UIScrollView delays delivering touches to its content by ~150ms to
        // decide if the gesture is a scroll — which makes a Button inside any
        // ScrollView (e.g. the When planner, filter chips, feed cards) feel like
        // it ignores the first tap. Deliver touches immediately; scrolling still
        // works because canCancelContentTouches stays true.
        UIScrollView.appearance().delaysContentTouches = false
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushRegistrar.shared.handle(deviceToken: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Simulator and un-provisioned builds land here. Nothing to do.
    }
}
