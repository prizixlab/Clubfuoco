import SwiftUI

/// Shown in place of account-required surfaces (Tickets, You) while browsing
/// as a session-less guest. Routes back to the auth flow. Guideline 5.1.1(v):
/// browsing stays open; only account actions are gated.
struct GuestGateView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 40))
                .foregroundStyle(Theme.sand)

            Text(locale.t("gate.title"))
                .font(.cfSerif(24))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)

            Text(locale.t("splash.guestNote"))
                .font(.cfSans(13))
                .foregroundStyle(Theme.stone)
                .multilineTextAlignment(.center)

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
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.cream)
    }
}
