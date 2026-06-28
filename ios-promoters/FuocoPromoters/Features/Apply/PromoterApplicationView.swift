import SwiftUI
import UIKit

@MainActor
final class ApplicationModel: ObservableObject {
    @Published var loading = true
    @Published var application: PromoterApplication?
    let repo = PromoterRepo()

    func load() async {
        loading = true
        application = try? await repo.myApplication()
        loading = false
    }
}

/// Locked verification screen for a promoter account that isn't approved yet.
/// Email is verified (they signed up via OTP); Instagram is pending a DM'd code
/// + manual 5k-follower review.
struct PromoterApplicationView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model = ApplicationModel()

    /// The Instagram account promoters DM their code to.
    private static let fuocoIG = "@fuoco.promoters"

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            if model.loading {
                ProgressView().tint(Theme.parchment)
            } else {
                content
            }
        }
        .task { await model.load() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Kicker("Verification", color: Theme.ember)
                    Text("You're almost in.")
                        .font(.cfSerif(40)).foregroundStyle(Theme.parchment)
                    Text("We verify every promoter by email and Instagram before unlocking the app.")
                        .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(.top, 12)

                // Email — already verified via signup OTP.
                statusRow(icon: "checkmark.seal.fill", color: Theme.gold,
                          title: "Email verified",
                          sub: auth.email ?? "")

                // Instagram — pending DM verification.
                instagramCard

                Button {
                    Haptics.tap(); Task { await auth.refresh() }
                } label: {
                    Text("Check status")
                        .font(.cfMono(12, weight: .medium)).kerning(2)
                        .foregroundStyle(Theme.parchment)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .overlay(Capsule().stroke(Theme.parchmentFaint))
                }

                Button { Task { await auth.signOut() } } label: {
                    Text("Sign out").font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                }
                .frame(maxWidth: .infinity)

                Spacer(minLength: 40)
            }
            .padding(24)
        }
    }

    private var instagramCard: some View {
        let handle = model.application?.instagram ?? ""
        let code = model.application?.igCode ?? "—"
        let verified = model.application?.igVerified == true
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: verified ? "checkmark.seal.fill" : "hourglass")
                    .foregroundStyle(verified ? Theme.gold : Theme.flame)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verified ? "Instagram verified" : "Instagram — pending")
                        .font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                    if !handle.isEmpty {
                        Text(handle).font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                    }
                }
                Spacer()
            }

            if !verified {
                Divider().background(Theme.hairline)
                Text("DM this code to **\(Self.fuocoIG)** from your Instagram. We'll confirm it's you and that you have **5,000+ followers**, then unlock your account.")
                    .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)

                HStack {
                    Text(code)
                        .font(.cfMono(20, weight: .medium)).kerning(2)
                        .foregroundStyle(Theme.ember)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = code; Haptics.success()
                    } label: {
                        Image(systemName: "doc.on.doc").foregroundStyle(Theme.parchment)
                            .frame(width: 36, height: 36)
                            .background(Circle().stroke(Theme.parchmentFaint))
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.night))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))
    }

    private func statusRow(icon: String, color: Color, title: String, sub: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(color)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                if !sub.isEmpty { Text(sub).font(.cfSans(12)).foregroundStyle(Theme.parchmentDim) }
            }
            Spacer()
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }
}
