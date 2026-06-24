import Foundation
import SwiftUI

/// Account type drives which tab set the app shows (see BottomNav.tsx).
/// Unknown values fall back to .user, matching AuthContext's behavior.
enum AccountType: String, Decodable, Sendable {
    case user, club, dj

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AccountType(rawValue: raw) ?? .user
    }
}

/// Self-declared gender, required at signup. Drives guest-list payout
/// settlement (clubs pay promoters different per-head rates by gender);
/// `preferNotToSay` settles at the higher rate as the legal default.
enum Gender: String, CaseIterable, Sendable, Identifiable {
    case male
    case female
    case preferNotToSay = "prefer_not_to_say"

    var id: String { rawValue }
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
    let gender: String?
    let accountType: AccountType?
    let role: String?
    let stripeCustomerId: String?
    let createdAt: String?

    /// Same completeness rule routeAfterOAuth() applies before allowing the
    /// user past /complete-profile. Gender was added 2026-06-22 for guest-list
    /// payout settlement — existing rows without one re-enter complete-profile
    /// on next launch (see RootView's gate).
    var isComplete: Bool {
        fullName?.isEmpty == false && email?.isEmpty == false
            && phone?.isEmpty == false && birthday?.isEmpty == false
            && gender?.isEmpty == false
    }
}

/// Three-pill selector used by the signup wizard and complete-profile screens.
/// Stays here to keep gender UI co-located with the enum.
struct GenderPicker: View {
    @Binding var selection: Gender?
    let locale: LocaleStore

    var body: some View {
        // Two-row layout: Male/Female share the top row at equal width;
        // "Prefer not to say" gets its own full-width row underneath so its
        // longer label never clips. Order matches Gender.allCases.
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                chip(.male)
                chip(.female)
            }
            chip(.preferNotToSay)
        }
    }

    @ViewBuilder
    private func chip(_ g: Gender) -> some View {
        let isSelected = selection == g
        Button {
            selection = g
            Haptics.tap()
        } label: {
            Text(locale.t("signup.gender.\(g.rawValue)"))
                .font(.cfSans(13, weight: .medium))
                .foregroundStyle(isSelected ? Theme.cream : Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(isSelected ? Theme.wine : Color.white, in: .rect(cornerRadius: 11))
                .overlay(RoundedRectangle(cornerRadius: 11)
                    .stroke(isSelected ? Theme.wine : Theme.hairline))
        }
        .buttonStyle(.plain)
    }
}
