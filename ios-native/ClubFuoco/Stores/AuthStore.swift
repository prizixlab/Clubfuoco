import Foundation
import Observation
import Supabase

/// Mirrors AuthContext: publishes the Supabase user, the resolved account
/// type (from users.account_type), and a loading flag while the initial
/// session check is in flight. Reacts to every auth state change.
///
/// Also owns the signup/OAuth onboarding flows: while `onboardingInProgress`
/// is true RootView keeps showing the auth flow even though a session already
/// exists (the signup wizard signs the user in mid-flow, before birthday and
/// membership steps — same as the web wizard, which routes manually).
/// Signup pre-flight conflicts — surface these on the details step instead of
/// letting the user sail through to the OTP screen.
enum SignupConflict: LocalizedError {
    case emailTaken
    case phoneTaken

    var errorDescription: String? {
        switch self {
        case .emailTaken: "This email is already registered. Try signing in instead."
        case .phoneTaken: "This phone number is already linked to another account."
        }
    }
}

@MainActor
@Observable
final class AuthStore {
    enum State: Equatable {
        case loading
        case signedOut
        case signedIn
    }

    private(set) var state: State = .loading
    private(set) var user: User?
    private(set) var profile: UserProfile?
    var onboardingInProgress = false

    /// Session-less guest browsing. The intended guest flow is an anonymous
    /// Supabase session, but anonymous sign-up currently 500s in production
    /// (DB trigger), and the web splash swallows that and routes guests in
    /// anyway — so "guest" must work with no session at all. Not persisted:
    /// a relaunched guest lands back on the splash, same as web.
    private(set) var guestMode = false

    var accountType: AccountType { profile?.accountType ?? .user }
    var isAnonymous: Bool { user?.isAnonymous ?? false }

    private let supabase: SupabaseService
    let queries: Queries

    init(supabase: SupabaseService, queries: Queries) {
        self.supabase = supabase
        self.queries = queries
    }

    /// Subscribe to auth changes. The stream replays the stored session first
    /// (.initialSession), so this also performs the cold-start hydration.
    ///
    /// A watchdog flips state to `.signedOut` if `.initialSession` doesn't
    /// arrive within 6s — without it, a stalled Keychain read or an unreachable
    /// auth endpoint (Apple's IPv6-only review network) leaves SplashView on
    /// screen forever, which is the failure mode App Review flagged 2026-06-21.
    func start() async {
        // Fresh-install detector. UserDefaults is wiped by uninstall but
        // Keychain isn't — without this, a reinstalled app silently restores
        // the previous session, which is confusing during testing and not
        // what users expect after "delete the app and start over." Sign out
        // before subscribing to authStateChanges so the first event we see
        // is the post-signout .signedOut, not the stale .initialSession.
        let sentinelKey = "cf.installSentinel"
        if !UserDefaults.standard.bool(forKey: sentinelKey) {
            UserDefaults.standard.set(true, forKey: sentinelKey)
            try? await supabase.client.auth.signOut()
        }

        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, self.state == .loading else { return }
            self.state = .signedOut
        }
        for await (event, session) in supabase.client.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                user = session?.user
                if session != nil {
                    // Show the app immediately; resolve the profile (account
                    // type, tier) in the background — same as AuthContext,
                    // which sets `user` first and account_type when it lands.
                    state = .signedIn
                    Task { await self.refreshProfile() }
                } else {
                    state = .signedOut
                }
            case .signedOut:
                user = nil
                profile = nil
                onboardingInProgress = false
                state = .signedOut
            default:
                break
            }
        }
    }

    /// Hard ceiling on any auth network call so the UI can never get stuck on
    /// an indefinite spinner — the URLSession-level timeouts are the primary
    /// defense; this is a second layer in case a transport-level error is
    /// swallowed somewhere below us.
    private func withAuthTimeout<T: Sendable>(
        _ seconds: UInt64 = 25,
        _ op: @Sendable @escaping () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await op() }
            group.addTask {
                try await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                throw URLError(.timedOut)
            }
            let result = try await group.next()!
            group.cancelAll()
            return result
        }
    }

    /// Mirrors resolveAccountType() — any failure falls back to a plain user.
    func refreshProfile() async {
        profile = try? await queries.me()
        // Separate identities: a promoter account can't use the consumer app.
        if profile?.accountKind == "promoter" {
            try? await supabase.client.auth.signOut()
            user = nil; profile = nil; onboardingInProgress = false
            state = .signedOut
        }
    }

    // ── Email / password ──────────────────────────────────────────────────────

    func signIn(email: String, password: String) async throws {
        // Transparent retry on transient transport failures (URLError: timeout,
        // not-connected, DNS, cancelled). Auth-level errors — wrong password,
        // unconfirmed email, rate-limited — surface immediately on the first
        // attempt so the user sees the real reason. Three attempts total with
        // 600ms / 1500ms backoff, so most flaky-network sign-ins succeed
        // silently and the reviewer never sees an error banner.
        let delays: [UInt64] = [600_000_000, 1_500_000_000]
        var attempt = 0
        while true {
            do {
                try await withAuthTimeout { [supabase] in
                    try await supabase.client.auth.signIn(email: email, password: password)
                }
                return
            } catch let error as URLError where attempt < delays.count {
                _ = error
                try? await Task.sleep(nanoseconds: delays[attempt])
                attempt += 1
            }
        }
        // authStateChanges delivers .signedIn and updates published state.
    }

    /// Mirrors handleSignup: metadata mirrors the web payload so the DB
    /// trigger creates the same users row. Returns true when an email OTP
    /// verification step is required (no session yet).
    ///
    /// Throws `SignupConflict.emailTaken` if Supabase signals the email is
    /// already registered. The confirmation-required signup response for an
    /// existing email returns a faux user with `identities: []` (Supabase's
    /// anti-enumeration design). We surface that as a real error instead of
    /// sending the user to an OTP screen that will never receive a code.
    func signUp(email: String, password: String, firstName: String, lastName: String) async throws -> Bool {
        onboardingInProgress = true
        let fullName = "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
        let response = try await withAuthTimeout { [supabase] in
            try await supabase.client.auth.signUp(
                email: email,
                password: password,
                data: [
                    "full_name": .string(fullName),
                    "first_name": .string(firstName),
                    "last_name": .string(lastName),
                    "account_type": .string("user"),
                ]
            )
        }
        if (response.user.identities ?? []).isEmpty {
            onboardingInProgress = false
            throw SignupConflict.emailTaken
        }
        return response.session == nil
    }

    /// Pre-flight phone uniqueness check via the `check_phone_exists` RPC
    /// (SECURITY DEFINER function — bypasses RLS without exposing the phone
    /// column to anon reads). Fails open: if the RPC errors we let signup
    /// proceed so a transient network issue doesn't block account creation.
    func phoneIsTaken(_ phone: String) async -> Bool {
        struct Params: Encodable { let p_phone: String }
        do {
            let exists: Bool = try await supabase.client
                .rpc("check_phone_exists", params: Params(p_phone: phone))
                .execute().value
            return exists
        } catch {
            return false
        }
    }

    /// Mirrors handleVerify (6–8 digit signup OTP).
    func verifySignupOTP(email: String, code: String) async throws {
        try await withAuthTimeout { [supabase] in
            try await supabase.client.auth.verifyOTP(email: email, token: code, type: .signup)
        }
    }

    func resendSignupOTP(email: String) async throws {
        try await withAuthTimeout { [supabase] in
            try await supabase.client.auth.resend(email: email, type: .signup)
        }
    }

    // ── Password recovery (forgot password) ──────────────────────────────────
    // Native OTP flow: send a recovery code → verify it (creates a recovery
    // session) → set the new password. Mirrors the signup OTP path so it uses
    // the same email delivery the app already relies on.
    //
    // Requires the Supabase "Reset Password" email template to include the
    // {{ .Token }} variable (same as the signup template), or the code won't
    // appear in the email.

    /// Step 1 — send (or resend) the 6-digit recovery code to the address.
    func sendPasswordReset(email: String) async throws {
        try await withAuthTimeout { [supabase] in
            try await supabase.client.auth.resetPasswordForEmail(email)
        }
    }

    /// Step 2 — verify the emailed code. On success Supabase mints a recovery
    /// session (the user is now transiently authenticated). We flag
    /// onboardingInProgress so RootView keeps showing the auth flow instead of
    /// bouncing into the app before the new password is set.
    func verifyPasswordRecoveryOTP(email: String, code: String) async throws {
        onboardingInProgress = true
        do {
            try await withAuthTimeout { [supabase] in
                try await supabase.client.auth.verifyOTP(email: email, token: code, type: .recovery)
            }
        } catch {
            onboardingInProgress = false
            throw error
        }
    }

    /// Step 3 — set the new password on the recovery session, then finish so
    /// RootView drops the (now signed-in) user into the app.
    func updatePassword(_ newPassword: String) async throws {
        try await withAuthTimeout { [supabase] in
            _ = try await supabase.client.auth.update(user: UserAttributes(password: newPassword))
        }
        await refreshProfile()
        onboardingInProgress = false
    }

    // ── Guest (Guideline 5.1.1(v)) ───────────────────────────────────────────

    /// Mirrors continueAsGuest(): try to mint an anonymous Supabase user so
    /// guests have a stable user.id — and enter the app regardless, exactly
    /// like the web splash (Explore is public).
    func signInAsGuest() async {
        guestMode = true
        do {
            try await withAuthTimeout(10) { [supabase] in
                try await supabase.client.auth.signInAnonymously()
            }
        } catch {
            // Anonymous sign-up currently 500s in production — browse without
            // a session, same net behavior as web. Also intentionally swallows
            // the timeout so guests aren't blocked on an unreachable auth host.
        }
    }

    /// Guest tapped "Create account" / "Sign in" — return to the auth flow.
    func exitGuestMode() {
        guestMode = false
    }

    // ── OAuth (Apple / Google → signInWithIdToken) ───────────────────────────

    /// Mirrors OAuthButtons: hand the provider ID token + raw nonce to
    /// Supabase. Returns whether the profile still needs completion (caller
    /// pushes the complete-profile screen).
    func signInWithIdToken(provider: OpenIDConnectCredentials.Provider, idToken: String, rawNonce: String?, providerName: String?) async throws -> Bool {
        onboardingInProgress = true
        try await withAuthTimeout { [supabase] in
            try await supabase.client.auth.signInWithIdToken(
                credentials: .init(provider: provider, idToken: idToken, nonce: rawNonce)
            )
        }

        // Apple only supplies the name on the FIRST authorization, and it never
        // rides in the ID token — so Supabase can't record it automatically. We
        // persist it ourselves in two places:
        //   1. The auth user's metadata → shows as "Display name" in the
        //      Supabase Authentication dashboard and is the canonical source.
        //   2. public.users.full_name → what the app reads everywhere.
        if let providerName, !providerName.isEmpty {
            try? await withAuthTimeout { [supabase] in
                _ = try await supabase.client.auth.update(
                    user: UserAttributes(data: [
                        "full_name": .string(providerName),
                        "name": .string(providerName),
                    ]))
            }
        }

        // Wait briefly for the post-signup DB trigger to create the users row
        // on a first-ever sign-in (otherwise the name update below no-ops).
        var row = try? await queries.me()
        for _ in 0..<3 where row == nil {
            try? await Task.sleep(nanoseconds: 400_000_000)
            row = try? await queries.me()
        }
        if let providerName, !providerName.isEmpty, (row?.fullName ?? "").isEmpty {
            try? await queries.updateMe(["full_name": .string(providerName)])
            row = try? await queries.me()
        }
        profile = row

        let incomplete = row == nil || !(row!.isComplete)
        if !incomplete { onboardingInProgress = false }
        return incomplete
    }

    /// Google via Supabase's hosted OAuth (ASWebAuthenticationSession). The
    /// native GoogleSignIn SDK can't be used here: AppAuth injects a nonce we
    /// can't reproduce, so GoTrue's hashed-nonce check always fails ("Nonces
    /// mismatch"). This redirect flow lets Supabase own the nonce server-side —
    /// the same path the web app uses. Returns whether the profile needs
    /// completion. The redirect URL must be allow-listed in the Supabase
    /// dashboard (Authentication → URL Configuration → Redirect URLs).
    func signInWithGoogleOAuth() async throws -> Bool {
        onboardingInProgress = true
        // 90s ceiling: this includes the time the user spends in the
        // ASWebAuthenticationSession sheet, not just network round-trips.
        let session = try await withAuthTimeout(90) { [supabase] in
            try await supabase.client.auth.signInWithOAuth(
                provider: .google,
                redirectTo: URL(string: "com.clubfuoco.app://login-callback")
            )
        }

        // OAuth carries the display name in user metadata — persist it if the
        // profile row has none (mirrors the providerName path above).
        let metaName = session.user.userMetadata["full_name"]?.stringValue
            ?? session.user.userMetadata["name"]?.stringValue
        var row = try? await queries.me()
        if let metaName, !metaName.isEmpty,
           row != nil, (row?.fullName ?? "").isEmpty {
            try? await queries.updateMe(["full_name": .string(metaName)])
            row = try? await queries.me()
        }
        profile = row

        let incomplete = row == nil || !(row!.isComplete)
        if !incomplete { onboardingInProgress = false }
        return incomplete
    }

    // ── Profile updates (complete-profile / signup birthday) ─────────────────

    func updateProfile(_ updates: [String: AnyJSON]) async throws {
        try await queries.updateMe(updates)
        await refreshProfile()
    }

    /// Onboarding finished (signup wizard or complete-profile) — let RootView
    /// switch to the main app.
    func finishOnboarding() {
        onboardingInProgress = false
    }

    func signOut() async {
        try? await supabase.client.auth.signOut()
    }
}
