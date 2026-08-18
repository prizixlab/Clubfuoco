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
    /// When set, the caller decides what happens after a successful sign-in and
    /// `path` is left alone.
    ///
    /// The invite lane needs the same two buttons without the navigation: a
    /// guest signing in from their ticket must stay on their ticket, not be
    /// pushed into the profile wizard mid-RSVP.
    var onSignedIn: ((_ needsProfile: Bool) -> Void)? = nil
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
                        // Official Google "G" logo (4-color vector asset),
                        // rendered as original to preserve the brand colors.
                        Image("google-g")
                            .renderingMode(.original)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 18, height: 18)
                    }
                    Text(locale.t("auth.continueGoogle"))
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.ink)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusField))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.ink.opacity(0.12)))
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
            // Apple sends the name ONLY on the user's first-ever authorization
            // of this app — re-auths (including after our account is deleted
            // server-side) return nil. Cache it in the keychain keyed by
            // Apple's stable per-app user id so later re-signups can still
            // prefill the name.
            var providerName = [credential.fullName?.givenName, credential.fullName?.familyName]
                .compactMap { $0 }
                .joined(separator: " ")
            if providerName.isEmpty {
                providerName = AppleNameCache.load(for: credential.user) ?? ""
            } else {
                AppleNameCache.save(providerName, for: credential.user)
            }
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
                if let onSignedIn {
                    onSignedIn(needsProfile)
                } else if needsProfile {
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
                if let onSignedIn {
                    onSignedIn(needsProfile)
                } else if needsProfile {
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

/// Keychain cache for the Apple-provided name (see handleApple). Keychain, not
/// UserDefaults: it survives app deletion, reinstalls, and server-side account
/// deletion — exactly the situations where Apple won't resend the name.
private enum AppleNameCache {
    private static func query(_ user: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.clubfuoco.apple-name",
         kSecAttrAccount as String: user]
    }

    static func save(_ name: String, for user: String) {
        var q = query(user)
        SecItemDelete(q as CFDictionary)
        q[kSecValueData as String] = Data(name.utf8)
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load(for user: String) -> String? {
        var q = query(user)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
