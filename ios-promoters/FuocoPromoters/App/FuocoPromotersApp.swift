import SwiftUI
import UIKit

/// Bridges the APNs registration callbacks (delegate-only API) into
/// PushManager. Registration itself is requested from PushManager.enable()
/// once a signed-in promoter reaches the main tabs.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushManager.shared.handleToken(deviceToken) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Best-effort — push is a layer on top of polling, never required.
    }
}

@main
struct FuocoPromotersApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        ValidDays.runSelfChecks()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}
