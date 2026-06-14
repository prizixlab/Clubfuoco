import SwiftUI

/// Composition root. Builds the service graph once and hands the pieces to
/// SwiftUI via `.environment`. Mirrors the provider stack in the web app's
/// root layout (AuthProvider / LocaleProvider / PlanProvider).
@MainActor
final class AppEnvironment {
    let supabase: SupabaseService
    let api: APIClient
    let queries: Queries
    let authStore: AuthStore
    let localeStore: LocaleStore
    let planStore: PlanStore
    let membershipStore: MembershipStore

    init() {
        let supabase = SupabaseService()
        self.supabase = supabase
        self.api = APIClient(tokenProvider: supabase)
        self.queries = Queries(supabase: supabase)
        self.authStore = AuthStore(supabase: supabase, queries: queries)
        self.localeStore = LocaleStore()
        self.planStore = PlanStore()
        self.membershipStore = MembershipStore(api: api)
    }
}

// ── Environment key for the (non-Observable) API client ──────────────────────

private struct APIClientKey: EnvironmentKey {
    static let defaultValue: APIClient = APIClient(tokenProvider: NoTokenProvider())
}

extension EnvironmentValues {
    var api: APIClient {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
}

/// Placeholder used only for the SwiftUI environment default value
/// (previews / accidental missing injection) — sends no Authorization header.
private struct NoTokenProvider: AuthTokenProvider {
    func accessToken() async -> String? { nil }
    func refreshSession() async -> String? { nil }
}
