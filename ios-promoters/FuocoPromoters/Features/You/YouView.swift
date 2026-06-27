import SwiftUI
import PhotosUI

@MainActor
final class ProfileModel: ObservableObject {
    @Published var loading = true
    @Published var brandName = ""
    @Published var instagram = ""
    @Published var bio = ""
    @Published var logoURL: String?
    @Published var uploadingLogo = false
    @Published var saving = false
    @Published var saved = false
    @Published var billing: PromoterRepo.BillingStatus?

    let repo = PromoterRepo()

    func load() async {
        loading = true
        if let p = try? await repo.getProfile() {
            brandName = p.brandName ?? ""
            instagram = p.instagram ?? ""
            bio = p.bio ?? ""
            logoURL = p.logoUrl
        }
        billing = try? await repo.billingStatus()
        loading = false
    }

    func uploadLogo(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let jpeg = CreateGuestlistModel.downscaledJPEG(data, maxDimension: 800) else { return }
        uploadingLogo = true
        defer { uploadingLogo = false }
        if let url = try? await repo.uploadLogo(jpeg) {
            logoURL = url
            try? await save()   // persist immediately so the logo sticks
        }
    }

    func save() async throws {
        saving = true; defer { saving = false }
        try await repo.saveProfile(
            brandName: brandName.isEmpty ? nil : brandName,
            logoUrl: logoURL,
            bio: bio.isEmpty ? nil : bio,
            instagram: instagram.isEmpty ? nil : instagram)
        saved = true
    }
}

struct YouView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: ProfileModel
    @State private var showShare = false
    @State private var logoItem: PhotosPickerItem?
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focused: Bool

    init() {
        _model = StateObject(wrappedValue: ProfileModel())
    }

    private var appURL: URL { URL(string: "https://apps.apple.com/app/fuoco-for-promoters/id0000000000")! }

    var body: some View {
        VStack(spacing: 0) {
            FuocoHeader(initials: initials)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    profileCard
                    if let b = model.billing, b.status != "active" {
                        pastDueBanner(b)
                    }
                    paymentSection
                    inviteSection
                    accountSection
                    legalRow
                    signOutButton
                    Text("FUOCO INTERNO")
                        .font(.cfMono(10)).kerning(3)
                        .foregroundStyle(Theme.parchmentFaint)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                }
                .padding(20)
            }
        }
        .background(Theme.night.ignoresSafeArea())
        .task { await reloadForCurrentUser() }
        .onChange(of: scenePhase) { _, p in if p == .active { Task { await model.load() } } }
        .onChange(of: logoItem) { _, item in Task { await model.uploadLogo(item) } }
        .toolbar { ToolbarItemGroup(placement: .keyboard) {
            Button("Done") { focused = false }.foregroundStyle(Theme.ember); Spacer() } }
        .sheet(isPresented: $showShare) {
            ShareSheet(items: ["Join me on Fuoco For Promoters:", appURL])
                .presentationDetents([.medium])
        }
    }

    private func reloadForCurrentUser() async {
        // ProfileModel was created with a placeholder id; rebuild load against
        // the signed-in promoter (the repo uses the session id internally).
        await model.load()
    }

    // MARK: Profile

    private var profileCard: some View {
        VStack(spacing: 16) {
            PhotosPicker(selection: $logoItem, matching: .images) {
                ZStack {
                    Circle().fill(Theme.nightLift).frame(width: 96, height: 96)
                        .overlay(Circle().stroke(Theme.hairline))
                    if let url = model.logoURL, let u = URL(string: url) {
                        AsyncImage(url: u) { img in img.resizable().scaledToFill() }
                            placeholder: { ProgressView().tint(Theme.parchmentDim) }
                            .frame(width: 96, height: 96).clipShape(Circle())
                    } else {
                        VStack(spacing: 4) {
                            Image(systemName: "camera").font(.system(size: 22)).foregroundStyle(Theme.flame)
                            Text("Logo").font(.cfMono(9)).kerning(1).foregroundStyle(Theme.parchmentDim)
                        }
                    }
                    if model.uploadingLogo {
                        Circle().fill(.black.opacity(0.5)).frame(width: 96, height: 96)
                        ProgressView().tint(.white)
                    }
                }
            }

            VStack(spacing: 12) {
                field("Brand name", text: $model.brandName, placeholder: "e.g. Noir Collective")
                field("Instagram", text: $model.instagram, placeholder: "@yourbrand", lower: true)
                VStack(alignment: .leading, spacing: 6) {
                    Kicker("Bio", color: Theme.parchmentDim)
                    TextField("", text: $model.bio,
                              prompt: Text("A line about your nights.").foregroundStyle(Theme.parchmentDim),
                              axis: .vertical)
                        .lineLimit(2...4)
                        .font(.cfSans(14)).foregroundStyle(Theme.parchment).focused($focused)
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.night))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                }
            }

            Button {
                Task { try? await model.save(); Haptics.success() }
            } label: {
                Text(model.saving ? "Saving…" : (model.saved ? "Saved ✓" : "Save profile"))
                    .font(.cfSans(14, weight: .semibold)).foregroundStyle(Theme.emberCream)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Capsule().fill(Theme.ember))
            }
            .disabled(model.saving)
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))
    }

    // MARK: Payment

    private var paymentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker("Payment method", color: Theme.parchmentDim)
            if let b = model.billing, b.cardVerified {
                HStack(spacing: 10) {
                    Image(systemName: "creditcard.fill").foregroundStyle(Theme.gold)
                    Text("\(b.cardBrand?.capitalized ?? "Card") ending \(b.cardLast4 ?? "••••")")
                        .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                    Spacer()
                    Button("Update") { Task { await openBilling() } }
                        .font(.cfSans(13)).foregroundStyle(Theme.ember)
                }
            } else {
                Button { Task { await openBilling() } } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "creditcard")
                        Text("Add a payment method").font(.cfSans(14, weight: .medium))
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 12))
                    }
                    .foregroundStyle(Theme.parchment)
                }
            }
            Text("Used only for front-page promotion (€0.30 per accepted guest). Nothing else is charged.")
                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func pastDueBanner(_ b: PromoterRepo.BillingStatus) -> some View {
        let owed = Double(-b.balanceCents) / 100
        return HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.wine)
            VStack(alignment: .leading, spacing: 2) {
                Text("Balance due: €\(String(format: "%.2f", max(0, owed)))")
                    .font(.cfSans(14, weight: .semibold)).foregroundStyle(Theme.parchment)
                Text("Promotions are paused until this is settled.")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
            Spacer()
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.wine.opacity(0.15)))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.wine.opacity(0.5)))
    }

    // MARK: Invite / Account / Legal

    private var inviteSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker("Bring someone in", color: Theme.parchmentDim)
            Button { showShare = true } label: {
                HStack(spacing: 8) {
                    Image(systemName: "person.badge.plus")
                    Text("Invite a colleague").font(.cfSans(14, weight: .medium))
                    Spacer()
                    Image(systemName: "square.and.arrow.up").font(.system(size: 13))
                }
                .foregroundStyle(Theme.parchment)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker("Signed in as", color: Theme.parchmentDim)
            if case .signedIn(let p) = auth.state {
                Text(p.email ?? p.displayName).font(.cfSans(15)).foregroundStyle(Theme.parchment)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private var legalRow: some View {
        HStack(spacing: 20) {
            Link("Privacy", destination: URL(string: "https://clubfuoco.com/legal/privacy")!)
            Link("Terms", destination: URL(string: "https://clubfuoco.com/legal/terms")!)
            Spacer()
            Text("v0.1").font(.cfMono(10)).foregroundStyle(Theme.parchmentFaint)
        }
        .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
        .padding(.horizontal, 4)
    }

    private var signOutButton: some View {
        Button { Task { await auth.signOut() } } label: {
            Text("Sign out")
                .font(.cfMono(11, weight: .medium)).kerning(2)
                .foregroundStyle(Theme.ember)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .overlay(Capsule().stroke(Theme.ember.opacity(0.6)))
        }
    }

    private func openBilling() async {
        if let url = try? await model.repo.billingSetupURL() { openURL(url) }
    }

    @ViewBuilder
    private func field(_ label: String, text: Binding<String>, placeholder: String, lower: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label, color: Theme.parchmentDim)
            TextField("", text: text, prompt: Text(placeholder).foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(16)).foregroundStyle(Theme.parchment).focused($focused)
                .textInputAutocapitalization(lower ? .never : .words)
                .autocorrectionDisabled(lower)
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
        }
    }

    private var initials: String {
        if case .signedIn(let p) = auth.state { return String(p.displayName.prefix(1)).uppercased() }
        return ""
    }
}
