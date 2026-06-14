import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        // Note: if/else keeps AuthFlowView's identity stable while the signup
        // wizard signs the user in mid-flow (signedOut → signedIn while
        // onboardingInProgress) — a switch over state would reset the wizard.
        if auth.state == .loading {
            SplashView()
        } else if auth.onboardingInProgress || (auth.state == .signedOut && !auth.guestMode) {
            AuthFlowView()
        } else {
            MainTabView()
        }
    }
}

/// Boot splash while the stored session is restored — dark, matching the
/// welcome screen so cold start doesn't flash between themes.
struct SplashView: View {
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            VStack(spacing: 16) {
                Text("CLUB FUOCO")
                    .font(.cfSerif(28))
                    .kerning(8)
                    .foregroundStyle(Theme.parchment)
                    .padding(.leading, 8)
                Text(locale.t("splash.tagline"))
                    .font(.cfSerif(15, italic: true))
                    .foregroundStyle(Theme.parchment.opacity(0.6))
            }
        }
    }
}
