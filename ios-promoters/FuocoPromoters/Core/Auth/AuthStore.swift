import Foundation
import Supabase

@MainActor
final class AuthStore: ObservableObject {
    enum State { case loading, signedOut, signedIn(PromoterProfile) }

    @Published private(set) var state: State = .loading
    @Published var errorMessage: String?

    var email: String? { if case .signedIn(let p) = state { return p.email }; return nil }

    private let sb = SupabaseService.shared

    init() {
        Task { await bootstrap() }
    }

    func bootstrap() async {
        do {
            let session = try await sb.client.auth.session
            await loadProfile(userId: session.user.id)
        } catch {
            state = .signedOut
        }
    }

    func signIn(email: String, password: String) async {
        errorMessage = nil
        state = .loading
        do {
            let session = try await sb.client.auth.signIn(email: email, password: password)
            await loadProfile(userId: session.user.id)
            // Separate identities: only promoter accounts may use this app.
            if case .signedIn(let p) = state, p.accountKind != "promoter" {
                try? await sb.client.auth.signOut()
                state = .signedOut
                errorMessage = "This is a Club Fuoco account, not a promoter account. Use the Club Fuoco app, or apply to promote."
            }
        } catch {
            errorMessage = "Couldn't sign in — check your email & password."
            state = .signedOut
        }
    }

    /// Re-fetch the profile (e.g. after a promoter application is approved in
    /// Studio) without bouncing through the loading state.
    func refresh() async {
        if let uid = try? await sb.client.auth.session.user.id {
            await loadProfile(userId: uid)
        }
    }

    enum SignUpError: Error { case emailTaken }

    /// Create a promoter account. Returns true if an email OTP is required
    /// (email confirmation is ON in prod), false if a session was issued.
    func signUp(email: String, password: String, fullName: String) async throws -> Bool {
        errorMessage = nil
        let resp = try await sb.client.auth.signUp(
            email: email, password: password,
            data: [
                "full_name": .string(fullName),
                "account_type": .string("user"),
            ])
        if (resp.user.identities ?? []).isEmpty { throw SignUpError.emailTaken }
        return resp.session == nil
    }

    func verifySignupOTP(email: String, code: String) async throws {
        try await sb.client.auth.verifyOTP(email: email, token: code, type: .signup)
        if let uid = try? await sb.client.auth.session.user.id {
            await loadProfile(userId: uid)
        }
    }

    func resendSignupOTP(email: String) async throws {
        try await sb.client.auth.resend(email: email, type: .signup)
    }

    func signOut() async {
        try? await sb.client.auth.signOut()
        state = .signedOut
    }

    /// Send a Supabase password-reset email to the signed-in address.
    func sendPasswordReset() async throws {
        guard let email else { throw NSError(domain: "Auth", code: 0,
            userInfo: [NSLocalizedDescriptionKey: "No email on this account."]) }
        try await sb.client.auth.resetPasswordForEmail(email)
    }

    /// Permanently delete this account via the shared web endpoint (same one
    /// the consumer app uses; requireAuth scopes it to the caller). Signs out
    /// locally on success so RootView returns to the sign-in screen.
    func deleteAccount() async throws {
        let token = try await sb.client.auth.session.accessToken
        var req = URLRequest(url: URL(string: "https://clubfuoco.com/api/account/delete")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let msg = (try? JSONDecoder().decode([String: String?].self, from: data))?["error"] as? String
            throw NSError(domain: "Auth", code: 1,
                userInfo: [NSLocalizedDescriptionKey: msg ?? "Couldn't delete your account. Try again."])
        }
        try? await sb.client.auth.signOut()
        state = .signedOut
    }

    private func loadProfile(userId: UUID) async {
        struct Row: Decodable {
            let id: UUID
            let email: String?
            let fullName: String?
            let isPromoter: Bool?
            let accountKind: String?
        }
        do {
            let row: Row = try await sb.client
                .from("users")
                .select("id,email,full_name,is_promoter,account_kind")
                .eq("id", value: userId)
                .single()
                .execute()
                .value
            state = .signedIn(PromoterProfile(
                id: row.id,
                email: row.email,
                fullName: row.fullName,
                isPromoter: row.isPromoter ?? false,
                accountKind: row.accountKind ?? "user"
            ))
        } catch {
            state = .signedIn(PromoterProfile(
                id: userId, email: nil, fullName: nil, isPromoter: false, accountKind: "user"
            ))
        }
    }
}
