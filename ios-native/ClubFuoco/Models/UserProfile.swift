import Foundation

/// Account type drives which tab set the app shows (see BottomNav.tsx).
/// Unknown values fall back to .user, matching AuthContext's behavior.
enum AccountType: String, Decodable, Sendable {
    case user, club, dj

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AccountType(rawValue: raw) ?? .user
    }
}

/// Row from public.users (`select('*')` — we model only the fields the app
/// reads; Codable ignores the rest). Dates stay String: Postgres date columns
/// arrive as "YYYY-MM-DD", timestamps as ISO 8601 with variable precision.
struct UserProfile: Decodable, Sendable {
    let id: UUID
    let email: String?
    let fullName: String?
    let phone: String?
    let birthday: String?
    let accountType: AccountType?
    let membershipTier: String?
    let role: String?
    let stripeCustomerId: String?
    let createdAt: String?

    /// Same completeness rule routeAfterOAuth() applies before allowing the
    /// user past /complete-profile.
    var isComplete: Bool {
        fullName?.isEmpty == false && email?.isEmpty == false
            && phone?.isEmpty == false && birthday?.isEmpty == false
    }
}
