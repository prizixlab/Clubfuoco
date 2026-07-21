import SwiftUI
import GoogleSignIn

@main
struct ClubFuocoApp: App {
    @State private var env = AppEnvironment()
    @Environment(\.scenePhase) private var scenePhase
    // SwiftUI exposes no hook for the APNs device-token callback, so a minimal
    // app delegate is adopted purely to receive it (see PushRegistrar).
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                // The entire design is a hardcoded light (cream/ink) palette with
                // no dark variant. Without this, Dark Mode renders TextField text
                // as Color.primary (white) on the cream background — invisible.
                .preferredColorScheme(.light)
                .environment(env.authStore)
                .environment(env.localeStore)
                .environment(env.planStore)
                .environment(\.api, env.api)
                .onOpenURL { url in
                    if InviteLinkRouter.shared.handle(url: url) { return }
                    GIDSignIn.sharedInstance.handle(url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL {
                        _ = InviteLinkRouter.shared.handle(url: url)
                    }
                }
                .task { await env.authStore.start() }
                // Pull the live partner offer catalog (falls back to the bundle).
                .task {
                    #if DEBUG
                    ValidDays.runSelfChecks()
                    #endif
                    await RumbalistOffers.refresh(api: env.api)
                }
                // Re-pull on foreground so a partner switch made in the portal
                // shows up without a cold start.
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        Task { await RumbalistOffers.refresh(api: env.api) }
                    }
                }
            #if DEBUG
                // Simulator-only hook so automated runs can exercise the real
                // sign-in path: pass CF_TEST_EMAIL / CF_TEST_PASSWORD via
                // `simctl launch` (SIMCTL_CHILD_ prefix). No-op otherwise.
                .task {
                    let proc = ProcessInfo.processInfo.environment
                    if proc["CF_TEST_GUEST"] == "1" {
                        await env.authStore.signInAsGuest()
                        NSLog("CF_TEST guest sign-in attempted")
                    } else if let email = proc["CF_TEST_EMAIL"], let password = proc["CF_TEST_PASSWORD"] {
                        NSLog("CF_TEST auto-login starting for %@", email)
                        do {
                            try await env.authStore.signIn(email: email, password: password)
                            NSLog("CF_TEST auto-login OK")
                        } catch {
                            NSLog("CF_TEST auto-login FAILED: %@", String(describing: error))
                        }
                    } else {
                        NSLog("CF_TEST no credentials in environment")
                    }
                }
                // Test the morning-after notification on demand. Set
                // CF_TEST_MORNING_AFTER=1 (optionally CF_TEST_DELAY_SEC=<n>)
                // when launching the app — we'll grab the user's next upcoming
                // booking and schedule a one-off fire so you can see the prompt
                // without waiting for 10 AM the next day.
                .task {
                    let proc = ProcessInfo.processInfo.environment
                    guard proc["CF_TEST_MORNING_AFTER"] == "1" else { return }
                    let delay = TimeInterval(proc["CF_TEST_DELAY_SEC"] ?? "15") ?? 15
                    NSLog("CF_TEST morning-after: starting (delay=%.0fs)", delay)

                    for _ in 0..<20 {
                        if case .signedIn = env.authStore.state { break }
                        try? await Task.sleep(nanoseconds: 500_000_000)
                    }
                    if case .signedIn = env.authStore.state {} else {
                        NSLog("CF_TEST morning-after: not signed in after 10s — firing static fallback")
                        await NotificationService.shared.debugFireStatic(seconds: delay)
                        return
                    }
                    guard let resp = try? await env.queries.myBookings() else {
                        NSLog("CF_TEST morning-after: bookings fetch failed — firing static fallback")
                        await NotificationService.shared.debugFireStatic(seconds: delay)
                        return
                    }
                    let upcoming = resp.bookings
                        .filter { $0.status != "cancelled" }
                        .sorted { $0.bookingDate < $1.bookingDate }
                    if let target = upcoming.first {
                        NSLog("CF_TEST morning-after: scheduling for booking %@ in %.0fs",
                              target.id.uuidString, delay)
                        await NotificationService.shared.debugScheduleSoon(for: target, seconds: delay)
                    } else {
                        NSLog("CF_TEST morning-after: no upcoming booking — firing static fallback")
                        await NotificationService.shared.debugFireStatic(seconds: delay)
                    }
                }
            #endif
        }
    }
}
