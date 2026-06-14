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
    func start() async {
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

    /// Mirrors resolveAccountType() — any failure falls back to a plain user.
    func refreshProfile() async {
        profile = try? await queries.me()
    }

    // ── Email / password ──────────────────────────────────────────────────────

    func signIn(email: String, password: String) async throws {
        try await supabase.client.auth.signIn(email: email, password: password)
        // authStateChanges delivers .signedIn and updates published state.
    }

    /// Mirrors handleSignup: metadata mirrors the web payload so the DB
    /// trigger creates the same users row. Returns true when an email OTP
    /// verification step is required (no session yet).
    func signUp(email: String, password: String, firstName: String, lastName: String) async throws -> Bool {
        onboardingInProgress = true
        let fullName = "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
        let response = try await supabase.client.auth.signUp(
            email: email,
            password: password,
            data: [
                "full_name": .string(fullName),
                "first_name": .string(firstName),
                "last_name": .string(lastName),
                "account_type": .string("user"),
            ]
        )
        return response.session == nil
    }

    /// Mirrors handleVerify (6–8 digit signup OTP).
    func verifySignupOTP(email: String, code: String) async throws {
        try await supabase.client.auth.verifyOTP(email: email, token: code, type: .signup)
    }

    func resendSignupOTP(email: String) async throws {
        try await supabase.client.auth.resend(email: email, type: .signup)
    }

    // ── Guest (Guideline 5.1.1(v)) ───────────────────────────────────────────

    /// Mirrors continueAsGuest(): try to mint an anonymous Supabase user so
    /// guests have a stable user.id — and enter the app regardless, exactly
    /// like the web splash (Explore is public).
    func signInAsGuest() async {
        guestMode = true
        do {
            try await supabase.client.auth.signInAnonymously()
        } catch {
            // Anonymous sign-up currently 500s in production — browse without
            // a session, same net behavior as web.
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
        try await supabase.client.auth.signInWithIdToken(
            credentials: .init(provider: provider, idToken: idToken, nonce: rawNonce)
        )

        // routeAfterOAuth(): Apple only supplies the name on first sign-in —
        // persist it now if the profile has none.
        var row = try? await queries.me()
        if let providerName, !providerName.isEmpty,
           row != nil, (row?.fullName ?? "").isEmpty {
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
        let session = try await supabase.client.auth.signInWithOAuth(
            provider: .google,
            redirectTo: URL(string: "com.clubfuoco.app://login-callback")
        )

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
