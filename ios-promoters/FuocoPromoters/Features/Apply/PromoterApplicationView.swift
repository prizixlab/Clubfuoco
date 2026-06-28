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
    private static let fuocoIG = "@club_fuoco"
    private static let fuocoHandle = "club_fuoco"   // copied form (no @, pastes cleanly into IG search)
    @State private var copiedHandle = false
    @State private var checking = false
    @State private var showStatusSheet = false

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            if model.loading {
                ProgressView().tint(Theme.parchment)
            } else {
                content
            }
            if showStatusSheet { statusModal }
        }
        .task { await model.load() }
        .animation(.spring(duration: 0.3), value: showStatusSheet)
    }

    private var statusModal: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.6).ignoresSafeArea()
                .onTapGesture { showStatusSheet = false }
            statusCard.transition(.move(edge: .bottom))
        }
        .ignoresSafeArea()
    }

    private var statusCard: some View {
        let approved = model.application?.status == "approved"
        let igOK = model.application?.igVerified == true
        let title = approved ? "You're approved!" : (igOK ? "In final review" : "Still under review")
        let body = approved
            ? "Welcome in — tap below to start using Fuoco."
            : igOK
                ? "Your Instagram is verified. We're doing a final review and you'll be unlocked shortly."
                : "We haven't confirmed your Instagram DM yet. Make sure you've sent the code to \(Self.fuocoIG) from the account you signed up with."
        return VStack(spacing: 16) {
            Capsule().fill(Theme.parchmentFaint).frame(width: 40, height: 5).padding(.top, 10)
            ZStack {
                Circle().fill(RadialGradient(colors: [Theme.ember.opacity(0.25), .clear],
                                             center: .center, startRadius: 4, endRadius: 80))
                    .frame(width: 150, height: 150)
                Image(systemName: approved ? "checkmark.seal.fill" : "hourglass")
                    .font(.system(size: 40, weight: .light))
                    .foregroundStyle(approved ? Theme.gold : Theme.flame)
            }
            Text(title).font(.cfSerif(30)).foregroundStyle(Theme.parchment)
                .multilineTextAlignment(.center)
            Text(body).font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 24)
            EmberPillButton(title: approved ? "Let's go" : "Got it") {
                showStatusSheet = false
                if approved { Task { await auth.refresh() } }
            }
            .padding(.horizontal, 24)
            .padding(.top, 4)
        }
        .padding(.bottom, 44)   // clears the home indicator; card fills to the very bottom
        .frame(maxWidth: .infinity)
        .background(Theme.nightLift, in: .rect(topLeadingRadius: 28, topTrailingRadius: 28))
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Kicker("Verification status", color: Theme.ember)
                    Text(headline)
                        .font(.cfSerif(40)).foregroundStyle(Theme.parchment)
                    Text("We verify every promoter by email and Instagram before unlocking the app.")
                        .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(.top, 12)

                // Stage timeline.
                VStack(spacing: 12) {
                    statusRow(done: true, title: "Account created", sub: "Welcome to Fuoco")
                    statusRow(done: true, title: "Email verified", sub: auth.email ?? "")
                    // Instagram stage — the actionable DM card.
                    instagramCard
                }

                Button {
                    Haptics.tap(); Task { await reloadStatus() }
                } label: {
                    HStack(spacing: 8) {
                        if checking { ProgressView().tint(Theme.parchment).scaleEffect(0.8) }
                        Text(checking ? "Checking…" : "Check status")
                            .font(.cfMono(12, weight: .medium)).kerning(2)
                    }
                    .foregroundStyle(Theme.parchment)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .overlay(Capsule().stroke(Theme.parchmentFaint))
                }
                .disabled(checking)

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

                // Step 1 — the account to DM (tap to copy the handle).
                Text("1. DM us on Instagram")
                    .font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.flame)
                Button {
                    UIPasteboard.general.string = Self.fuocoHandle
                    Haptics.success()
                    withAnimation { copiedHandle = true }
                    Task { try? await Task.sleep(nanoseconds: 1_500_000_000); withAnimation { copiedHandle = false } }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "camera.circle.fill").font(.system(size: 26)).foregroundStyle(Theme.ember)
                        Text(Self.fuocoIG)
                            .font(.cfSerif(26)).foregroundStyle(Theme.parchment)
                        Spacer()
                        Image(systemName: copiedHandle ? "checkmark" : "doc.on.doc")
                            .foregroundStyle(copiedHandle ? Theme.flame : Theme.parchmentDim)
                    }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.ember.opacity(0.12)))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.ember.opacity(0.4)))
                }
                Text(copiedHandle ? "Copied — paste it into Instagram search." : "Tap to copy the handle.")
                    .font(.cfSans(11)).foregroundStyle(copiedHandle ? Theme.flame : Theme.parchmentDim)

                // Step 2 — the code to send.
                Text("2. Send this code")
                    .font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.flame)
                    .padding(.top, 4)
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

                Text("We'll confirm it's you and that you have **5,000+ followers**, then unlock your account.")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))
    }

    private var headline: String {
        if model.application?.status == "approved" { return "You're verified." }
        if model.application?.igVerified == true { return "Final review." }
        return "You're almost in."
    }

    private func reloadStatus() async {
        checking = true
        await model.load()
        checking = false
        // Show the status popup. (If approved, refreshing auth from the sheet's
        // button transitions RootView into the app.)
        showStatusSheet = true
    }

    private func statusRow(done: Bool, title: String, sub: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: done ? "checkmark.seal.fill" : "hourglass")
                .foregroundStyle(done ? Theme.gold : Theme.flame)
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
