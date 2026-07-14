import SwiftUI

/// Routes within the signed-out flow (NavigationStack path).
enum AuthRoute: Hashable {
    case login
    case signup
    case completeProfile
    case forgotPassword
}

/// Container for the signed-out experience: dark splash → login / signup /
/// complete-profile. Replaces Next's (auth) route group + _native/Splash.
struct AuthFlowView: View {
    @State private var path: [AuthRoute] = {
        #if DEBUG
        // Simulator automation: SIMCTL_CHILD_CF_TEST_AUTH_ROUTE=login|signup
        switch ProcessInfo.processInfo.environment["CF_TEST_AUTH_ROUTE"] {
        case "login": return [.login]
        case "signup": return [.signup]
        default: break
        }
        #endif
        return []
    }()

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(path: $path)
                .navigationDestination(for: AuthRoute.self) { route in
                    switch route {
                    case .login:
                        LoginView(path: $path)
                    case .signup:
                        SignupView(path: $path)
                    case .completeProfile:
                        CompleteProfileView()
                    case .forgotPassword:
                        ForgotPasswordView(path: $path)
                    }
                }
        }
        .tint(Theme.stone)
    }
}

/// Native port of _native/Splash.tsx — dark cinema theme with the fire glow,
/// and the three peer CTAs. "Continue as guest" MUST stay a peer button:
/// Apple Review rejected a build where it read as a footnote (5.1.1(v)).
struct WelcomeView: View {
    @Binding var path: [AuthRoute]
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var continuing = false

    var body: some View {
        ZStack {
            // Fire glow lives in an overlay of the background so its 760pt
            // canvas can't inflate the layout width (it clipped the footer
            // text when it sat directly in the ZStack).
            Theme.night
                .overlay {
                    RadialGradient(
                        stops: [
                            .init(color: Theme.flame.opacity(0.55), location: 0),
                            .init(color: Theme.ember.opacity(0.42), location: 0.22),
                            .init(color: Theme.darkRed.opacity(0.32), location: 0.42),
                            .init(color: .clear, location: 0.62),
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 380
                    )
                    .frame(width: 760, height: 760)
                    .offset(y: -130)
                }
                .ignoresSafeArea()
                .allowsHitTesting(false)

            VStack {
                Kicker("EST · MMXXVI · BARCELONA", color: Theme.parchment.opacity(0.6))
                    .padding(.top, 24)

                Spacer()

                VStack(spacing: 0) {
                    Kicker("N° 01 · BARCELONA", color: Theme.parchment.opacity(0.45), size: 9)
                        .padding(.bottom, 20)

                    Text("CLUB FUOCO")
                        .font(.cfSerif(34))
                        .kerning(10.9)
                        .foregroundStyle(Theme.parchment)
                        .padding(.bottom, 16)
                        // Compensate trailing kern so the wordmark centers
                        .padding(.leading, 10.9)

                    Text(locale.t("splash.tagline"))
                        .font(.cfSerif(20, italic: true))
                        .foregroundStyle(Theme.parchment.opacity(0.75))
                        .multilineTextAlignment(.center)
                        .padding(.bottom, 48)

                    VStack(spacing: 10) {
                        splashButton(locale.t("splash.createAccount"), prominent: true) {
                            path.append(.signup)
                        }
                        splashButton(locale.t("splash.signIn")) {
                            path.append(.login)
                        }
                        splashButton(continuing ? locale.t("splash.opening") : locale.t("splash.continueGuest")) {
                            guard !continuing else { return }
                            continuing = true
                            Task { await auth.signInAsGuest() }
                        }

                        Text(locale.t("splash.guestNote"))
                            .font(.cfSans(12))
                            .italic()
                            .foregroundStyle(Theme.parchment.opacity(0.55))
                            .multilineTextAlignment(.center)
                            .padding(.top, 14)
                    }

                    VStack(spacing: 8) {
                        Kicker(locale.t("splash.termsNote"), color: Theme.parchment.opacity(0.4))
                            .multilineTextAlignment(.center)
                        HStack(spacing: 14) {
                            Link(locale.t("signup.termsOfUse"), destination: LegalURLs.terms)
                            Text("·").foregroundStyle(Theme.parchment.opacity(0.3))
                            Link(locale.t("signup.privacyPolicy"), destination: LegalURLs.privacy)
                        }
                        .font(.cfSans(11, weight: .medium))
                        .tint(Theme.parchment.opacity(0.75))
                        .foregroundStyle(Theme.parchment.opacity(0.75))
                    }
                    .padding(.top, 24)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func splashButton(_ title: String, prominent: Bool = false, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Text(title)
                .font(.cfSans(15, weight: prominent ? .medium : .regular))
                .frame(maxWidth: .infinity)
                .frame(height: 55)
                .background(
                    prominent ? Theme.ember : Theme.emberCream.opacity(0.06),
                    in: .rect(cornerRadius: Theme.radiusField)
                )
                .overlay {
                    if !prominent {
                        RoundedRectangle(cornerRadius: Theme.radiusField)
                            .stroke(Theme.parchment.opacity(0.22))
                    }
                }
                .foregroundStyle(prominent ? Theme.emberCream : Theme.parchment)
        }
    }
}
