import SwiftUI

struct YouView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var inviteEmail = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Bring someone in.")
                    .font(.cfSerif(38))
                    .foregroundStyle(Theme.parchment)

                Text("Expand your inner circle. Sharing access allows a colleague to manage guestlists, track performance, and collaborate on upcoming events.")
                    .font(.cfSans(14))
                    .foregroundStyle(Theme.parchmentDim)
                    .lineSpacing(4)

                EmberPillButton(title: "Share invite") {
                    // share sheet hookup TBD
                }

                VStack(alignment: .leading, spacing: 10) {
                    Kicker("Email address")
                    TextField("", text: $inviteEmail,
                              prompt: Text("colleague@domain.com")
                                .foregroundStyle(Theme.parchmentDim))
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(Theme.parchment)
                        .font(.cfSans(15))
                        .padding(12)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: Theme.radiusCard)
                    .stroke(Theme.hairline, lineWidth: 1))

                Divider().background(Theme.hairline).padding(.vertical, 8)

                if case .signedIn(let p) = auth.state {
                    VStack(alignment: .leading, spacing: 8) {
                        Kicker("Signed in as")
                        Text(p.email ?? p.displayName)
                            .font(.cfSans(15))
                            .foregroundStyle(Theme.parchment)
                        if !p.isPromoter {
                            Text("⚠️  Your account isn't flagged as a promoter yet — ask an admin.")
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.wine)
                        }
                    }
                }

                Button(role: .destructive) {
                    Task { await auth.signOut() }
                } label: {
                    Text("Sign out")
                        .font(.cfSans(15, weight: .semibold))
                        .foregroundStyle(Theme.wine)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusPill)
                            .stroke(Theme.wine, lineWidth: 1))
                }
                .padding(.top, 12)

                Spacer(minLength: 60)
                Text("FUOCO INTERNO")
                    .font(.cfMono(10))
                    .kerning(3)
                    .foregroundStyle(Theme.parchmentFaint)
                    .frame(maxWidth: .infinity)
            }
            .padding(20)
        }
        .background(Theme.night)
    }
}
