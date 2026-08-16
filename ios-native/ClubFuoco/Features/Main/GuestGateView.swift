import SwiftUI

/// Shown in place of account-required surfaces (Tickets, You) and when a guest
/// reaches for an account action. Routes back to the auth flow.
///
/// Guideline 5.1.1(v): browsing stays open; only account actions are gated. This
/// view must never stand between someone and the catalogue.
///
/// It takes a `reason` so the gate names the thing the person was actually
/// reaching for. A gate that says "Sign in" asks for a favour; one that says
/// "Keep this venue" finishes the job they started, which is the whole reason
/// they tapped.
struct GuestGateView: View {
    enum Reason {
        case save          // bookmarking a venue
        case guestlist     // joining a promoter's list / an offer
        case tickets       // the Tickets tab
        case account       // the You tab
        case rumba         // joining a rumba
        case generic

        var icon: String {
            switch self {
            case .save:      "bookmark.fill"
            case .guestlist: "list.bullet.rectangle.fill"
            case .tickets:   "ticket.fill"
            case .account:   "person.crop.circle.badge.plus"
            case .rumba:     "person.2.fill"
            case .generic:   "person.crop.circle.badge.plus"
            }
        }

        /// Localisation key for the headline — what they get, not what we want.
        var titleKey: String {
            switch self {
            case .save:      "gate.saveTitle"
            case .guestlist: "gate.guestlistTitle"
            case .tickets:   "gate.ticketsTitle"
            case .account:   "gate.accountTitle"
            case .rumba:     "gate.rumbaTitle"
            case .generic:   "gate.title"
            }
        }

        var bodyKey: String {
            switch self {
            case .save:      "gate.saveBody"
            case .guestlist: "gate.guestlistBody"
            case .tickets:   "gate.ticketsBody"
            case .account:   "gate.accountBody"
            case .rumba:     "gate.rumbaBody"
            case .generic:   "splash.guestNote"
            }
        }
    }

    var reason: Reason = .generic

    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: reason.icon)
                .font(.system(size: 40))
                .foregroundStyle(Theme.sand)

            Text(locale.t(reason.titleKey))
                .font(.cfSerif(24))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)

            Text(locale.t(reason.bodyKey))
                .font(.cfSans(13))
                .foregroundStyle(Theme.stone)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                PrimaryButton(title: locale.t("splash.createAccount"), background: Theme.ember) {
                    auth.exitGuestMode()
                }
                Button {
                    auth.exitGuestMode()
                } label: {
                    Text(locale.t("splash.signIn"))
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
                }
            }
            .padding(.top, 8)

            // Browsing is never the thing being gated — say so, so the sheet
            // reads as an offer rather than a wall.
            Text(locale.t("gate.keepBrowsing"))
                .font(.cfMono(9)).kerning(0.8)
                .foregroundStyle(Theme.fadedSand)
                .multilineTextAlignment(.center)
                .padding(.top, 2)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.cream)
    }
}
