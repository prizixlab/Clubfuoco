import SwiftUI

@MainActor
final class ApplicationModel: ObservableObject {
    @Published var loading = true
    @Published var application: PromoterApplication?
    @Published var instagram = ""
    @Published var clubs = ""
    @Published var experience = ""
    @Published var submitting = false
    @Published var error: String?

    let repo = PromoterRepo()

    func load() async {
        loading = true
        application = try? await repo.myApplication()
        if let a = application {
            instagram = a.instagram ?? ""
            clubs = a.clubs ?? ""
            experience = a.experience ?? ""
        }
        loading = false
    }

    var isPending: Bool { application?.status == "pending" }
    var wasRejected: Bool { application?.status == "rejected" }

    func submit(userId: UUID) async {
        guard !clubs.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Tell us which clubs or scenes you work."
            return
        }
        submitting = true; error = nil
        do {
            application = try await repo.submitApplication(.init(
                userId: userId,
                instagram: instagram.isEmpty ? nil : instagram,
                clubs: clubs,
                experience: experience.isEmpty ? nil : experience))
            Haptics.success()
        } catch {
            self.error = "Couldn't submit — try again."
            Haptics.error()
        }
        submitting = false
    }
}

struct PromoterApplicationView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model = ApplicationModel()
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            if model.loading {
                ProgressView().tint(Theme.parchment)
            } else if model.isPending {
                pending
            } else {
                form
            }
        }
        .task { await model.load() }
    }

    // ── Pending state ─────────────────────────────────────────────────────────

    private var pending: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "hourglass")
                .font(.system(size: 40))
                .foregroundStyle(Theme.flame)
            Text("Application received")
                .font(.cfSerif(34))
                .foregroundStyle(Theme.parchment)
            Text("We're reviewing it. You'll get access here the moment you're approved.")
                .font(.cfSans(14))
                .foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Button {
                Haptics.tap()
                Task { await auth.refresh() }
            } label: {
                Text("Check status")
                    .font(.cfSans(14, weight: .semibold))
                    .foregroundStyle(Theme.parchment)
                    .padding(.horizontal, 24).padding(.vertical, 12)
                    .overlay(Capsule().stroke(Theme.parchmentFaint))
            }
            .padding(.top, 8)
            Spacer()
            signOutButton
        }
        .padding(24)
    }

    // ── Application form ──────────────────────────────────────────────────────

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Kicker("Fuoco for Promoters")
                    Text("Apply to promote")
                        .font(.cfSerif(40))
                        .foregroundStyle(Theme.parchment)
                    Text(model.wasRejected
                         ? "Your last application wasn't approved — you can update and re-apply."
                         : "Tell us about your nights. We onboard promoters by hand.")
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.parchmentDim)
                }

                field("Instagram (optional)") {
                    TextField("", text: $model.instagram,
                              prompt: Text("@yourhandle").foregroundStyle(Theme.parchmentDim))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.cfSans(16)).foregroundStyle(Theme.parchment)
                        .focused($focused)
                }

                field("Clubs / scenes you work") {
                    TextField("", text: $model.clubs,
                              prompt: Text("e.g. Opium, Pacha, techno nights")
                                .foregroundStyle(Theme.parchmentDim))
                        .font(.cfSans(16)).foregroundStyle(Theme.parchment)
                        .focused($focused)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Kicker("A bit about you (optional)")
                    TextField("", text: $model.experience,
                              prompt: Text("How many people you bring, who you work with…")
                                .foregroundStyle(Theme.parchmentDim),
                              axis: .vertical)
                        .lineLimit(3...6)
                        .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                        .focused($focused)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.parchment.opacity(0.06)))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
                }

                if let err = model.error {
                    Text(err).font(.cfSans(13)).foregroundStyle(Theme.wine)
                }

                EmberPillButton(title: model.wasRejected ? "Re-apply" : "Submit application",
                                loading: model.submitting) {
                    if case .signedIn(let p) = auth.state {
                        Task { await model.submit(userId: p.id) }
                    }
                }

                signOutButton
                Spacer(minLength: 40)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Button("Done") { focused = false }
                    .foregroundStyle(Theme.ember)
                Spacer()
            }
        }
    }

    private var signOutButton: some View {
        Button {
            Task { await auth.signOut() }
        } label: {
            Text("Sign out")
                .font(.cfSans(13))
                .foregroundStyle(Theme.parchmentDim)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func field<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            content()
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Theme.parchmentFaint).frame(height: 1)
                }
        }
    }
}
