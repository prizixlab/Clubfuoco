import Foundation
import Supabase

@MainActor
final class AuthStore: ObservableObject {
    enum State { case loading, signedOut, signedIn(PromoterProfile) }

    @Published private(set) var state: State = .loading
    @Published var errorMessage: String?

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

    private func loadProfile(userId: UUID) async {
        struct Row: Decodable {
            let id: UUID
            let email: String?
            let fullName: String?
            let isPromoter: Bool?
        }
        do {
            let row: Row = try await sb.client
                .from("users")
                .select("id,email,full_name,is_promoter")
                .eq("id", value: userId)
                .single()
                .execute()
                .value
            state = .signedIn(PromoterProfile(
                id: row.id,
                email: row.email,
                fullName: row.fullName,
                isPromoter: row.isPromoter ?? false
            ))
        } catch {
            state = .signedIn(PromoterProfile(
                id: userId, email: nil, fullName: nil, isPromoter: false
            ))
        }
    }
}
