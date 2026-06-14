import SwiftUI
import AuthenticationServices
import CryptoKit
import Supabase

/// Native port of OAuthButtons.tsx.
/// - Apple: native ASAuthorization sheet. We generate a raw nonce, send Apple
///   its SHA-256 (carried in the token), and pass the raw nonce to Supabase,
///   which re-hashes to compare.
/// - Google: Supabase's hosted OAuth redirect (signInWithGoogleOAuth). The
///   native GoogleSignIn SDK can't be used — AppAuth injects a nonce we can't
///   reproduce, so GoTrue's nonce check always fails ("Nonces mismatch").
struct OAuthButtonsView: View {
    @Binding var path: [AuthRoute]
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale

    @State private var googleLoading = false
    @State private var errorMessage: String?
    @State private var currentNonce: String?

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Rectangle().fill(Theme.hairline).frame(height: 1)
                Kicker(locale.t("auth.orContinueWith"), color: Theme.fadedSand, size: 9)
                    .fixedSize()
                Rectangle().fill(Theme.hairline).frame(height: 1)
            }

            // Google
            Button {
                signInGoogle()
            } label: {
                HStack(spacing: 10) {
                    if googleLoading {
                        ProgressView().tint(Theme.stone)
                    } else {
                        Text("G")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(hex: 0x4285F4))
                    }
                    Text(locale.t("auth.continueGoogle"))
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.ink)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Color.white, in: .rect(cornerRadius: Theme.radiusField))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Color(hex: 0x221E1A).opacity(0.12)))
            }
            .disabled(googleLoading)

            // Apple — system button (review-safe), styled to brand height
            SignInWithAppleButton(.continue) { request in
                let nonce = Self.randomNonce()
                currentNonce = nonce
                request.requestedScopes = [.fullName, .email]
                request.nonce = Self.sha256(nonce)
            } onCompletion: { result in
                handleApple(result)
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 52)
            .clipShape(.rect(cornerRadius: Theme.radiusField))

            if let errorMessage {
                FormError(message: errorMessage)
            }
        }
    }

    // ── Apple ─────────────────────────────────────────────────────────────────

    private func handleApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let error):
            // User-cancelled sheets shouldn't surface an error banner
            if (error as? ASAuthorizationError)?.code != .canceled {
                errorMessage = error.localizedDescription
            }
        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let idToken = String(data: tokenData, encoding: .utf8)
            else {
                errorMessage = locale.t("common.error")
                return
            }
            let providerName = [credential.fullName?.givenName, credential.fullName?.familyName]
                .compactMap { $0 }
                .joined(separator: " ")
            finishSignIn(provider: .apple, idToken: idToken, rawNonce: currentNonce, providerName: providerName)
        }
    }

    // ── Google ────────────────────────────────────────────────────────────────

    private func signInGoogle() {
        googleLoading = true
        errorMessage = nil
        Task {
            do {
                let needsProfile = try await auth.signInWithGoogleOAuth()
                Haptics.success()
                if needsProfile {
                    path.append(.completeProfile)
                }
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                // User dismissed the web sheet — no error banner.
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            googleLoading = false
        }
    }

    // ── Shared completion: token → Supabase → route ──────────────────────────

    private func finishSignIn(provider: OpenIDConnectCredentials.Provider, idToken: String, rawNonce: String?, providerName: String) {
        Task {
            do {
                // Both providers carry SHA-256(rawNonce) in the token's `nonce`
                // claim (Apple via request.nonce, Google via the nonce: arg), so
                // we pass the raw nonce and GoTrue re-hashes to compare.
                let needsProfile = try await auth.signInWithIdToken(
                    provider: provider,
                    idToken: idToken,
                    rawNonce: rawNonce,
                    providerName: providerName.isEmpty ? nil : providerName
                )
                Haptics.success()
                if needsProfile {
                    path.append(.completeProfile)
                }
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            googleLoading = false
        }
    }

    // ── Nonce helpers (mirror OAuthButtons.tsx) ───────────────────────────────

    static func randomNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
