import SwiftUI

struct YouView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var inviteEmail = ""
    @State private var showShare = false

    private var appURL: URL { URL(string: "https://apps.apple.com/app/fuoco-for-promoters/id0000000000")! }

    var body: some View {
        VStack(spacing: 0) {
            FuocoHeader(initials: initials)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Bring\nsomeone in.")
                        .font(.cfSerif(48))
                        .foregroundStyle(Theme.parchment)
                        .lineSpacing(2)
                        .padding(.top, 8)

                    Text("Expansion is the lifeblood of our circle. Invite a colleague who understands the rhythm of the city and the weight of the shadow.")
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.parchmentDim)
                        .lineSpacing(4)

                    VStack(alignment: .leading, spacing: 14) {
                        Kicker("Colleague email", color: Theme.parchmentDim)
                        TextField("", text: $inviteEmail,
                                  prompt: Text("example@fuoco.es")
                                    .foregroundStyle(Theme.parchmentDim))
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .foregroundStyle(Theme.parchment)
                            .font(.cfSans(15))
                            .padding(.vertical, 12)
                            .overlay(alignment: .bottom) {
                                Rectangle().fill(Theme.parchmentFaint).frame(height: 1)
                            }
                        EmberPillButton(title: "Share invite") {
                            showShare = true
                        }
                    }
                    .padding(18)
                    .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))

                    Divider().background(Theme.hairline).padding(.vertical, 12)

                    if case .signedIn(let p) = auth.state {
                        VStack(spacing: 8) {
                            Kicker("Signed in as", color: Theme.parchmentDim)
                            Text(p.email ?? p.displayName)
                                .font(.cfSerif(24))
                                .foregroundStyle(Theme.parchment)
                        }
                        .frame(maxWidth: .infinity)
                    }

                    Button(role: .destructive) {
                        Task { await auth.signOut() }
                    } label: {
                        Text("Sign out")
                            .font(.cfMono(11, weight: .medium)).kerning(2)
                            .foregroundStyle(Theme.ember)
                            .padding(.horizontal, 28).padding(.vertical, 13)
                            .overlay(Capsule().stroke(Theme.ember.opacity(0.6)))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)

                    Spacer(minLength: 50)
                    Text("FUOCO INTERNO")
                        .font(.cfMono(10)).kerning(3)
                        .foregroundStyle(Theme.parchmentFaint)
                        .frame(maxWidth: .infinity)
                }
                .padding(20)
            }
        }
        .background(Theme.night.ignoresSafeArea())
        .sheet(isPresented: $showShare) {
            ShareSheet(items: [
                "Join me on Fuoco For Promoters — manage your guestlists and track your nights:",
                appURL
            ])
            .presentationDetents([.medium])
        }
    }

    private var initials: String {
        if case .signedIn(let p) = auth.state { return String(p.displayName.prefix(1)).uppercased() }
        return ""
    }
}
