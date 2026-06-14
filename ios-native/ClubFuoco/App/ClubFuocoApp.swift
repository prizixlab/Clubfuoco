import SwiftUI
import GoogleSignIn

@main
struct ClubFuocoApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env.authStore)
                .environment(env.localeStore)
                .environment(env.planStore)
                .environment(env.membershipStore)
                .environment(\.api, env.api)
                .onOpenURL { GIDSignIn.sharedInstance.handle($0) }
                .task { await env.authStore.start() }
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
            #endif
        }
    }
}
