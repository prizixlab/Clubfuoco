import Foundation
import Supabase

/// Single Supabase client for the whole app — auth (session in Keychain,
/// auto-refresh) plus the direct PostgREST query path that mirrors
/// src/lib/supabase/queries.ts. Counterpart of src/lib/supabase/client.ts.
final class SupabaseService: @unchecked Sendable {
    static let supabaseURL = URL(string: "https://nqviodkapzjdkbgknauo.supabase.co")!
    // Anon key — public by design (same value the web bundle ships).
    static let anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdmlvZGthcHpqZGtiZ2tuYXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTE2MjIsImV4cCI6MjA5MzY4NzYyMn0.CygsWuRRUQY4e7OzX8VYlaaWfoQO6K9KWZP_StGEr18"

    let client: SupabaseClient

    init() {
        // Same snake_case strategy as APIClient so the Codable models work on
        // both data paths (REST envelope and PostgREST).
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase

        // URLSession.shared's defaults are 60s request / 7 days resource —
        // a single stalled TCP connection (Apple's IPv6-only review network
        // is the canonical trigger) leaves auth calls hanging forever and
        // the "Sign in" button stuck on "Please wait…". Cap both so failures
        // surface as an error instead of an infinite spinner.
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        let session = URLSession(configuration: config)

        client = SupabaseClient(
            supabaseURL: Self.supabaseURL,
            supabaseKey: Self.anonKey,
            options: SupabaseClientOptions(
                db: .init(encoder: encoder, decoder: decoder),
                global: .init(session: session)
            )
        )
    }
}

extension SupabaseService: AuthTokenProvider {
    /// `client.auth.session` refreshes an expired session before returning,
    /// which is exactly the guarantee apiFetch() gets from supabase-js.
    func accessToken() async -> String? {
        await currentSession()?.accessToken
    }

    func refreshSession() async -> String? {
        do { return try await client.auth.refreshSession().accessToken }
        catch { await signOutIfSessionDead(error); return nil }
    }

    /// Session for the direct PostgREST query paths, or nil when there is no
    /// usable one. Unlike a bare `try? client.auth.session`, this reacts to a
    /// dead session instead of masking it.
    func currentSession() async -> Session? {
        do { return try await client.auth.session }
        catch { await signOutIfSessionDead(error); return nil }
    }

    /// GoTrue explicitly rejected our refresh token (revoked, rotated away
    /// mid-kill, or expired) — the stored session can never recover. Clear it
    /// so authStateChanges emits .signedOut and RootView returns to the
    /// welcome screen. Without this the app runs a "zombie" signed-in UI:
    /// Tickets renders empty, favorites vanish, and every write 401s with no
    /// hint that signing back in would fix it. Network errors are left alone —
    /// those are transient and the session may still be fine.
    private func signOutIfSessionDead(_ error: Error) async {
        guard case let .api(_, code, _, _) = error as? AuthError,
              code == .refreshTokenNotFound || code == .refreshTokenAlreadyUsed
                || code == .sessionNotFound || code == .sessionExpired
        else { return }
        try? await client.auth.signOut(scope: .local)
    }
}
