import SwiftUI

// The "You" tab for a supplier account: shows the brand identity (logo, name,
// key, accent, login email) pulled live from /api/supplier/me, plus the same
// gear → Settings (account, legal, sign-out) the promoter You tab uses. Brand
// identity itself is managed in the Club Fuoco portal, so it's read-only here.
struct SupplierYouView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var brand: SupplierBrand?
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            FuocoHeader(initials: initials, logoURL: brand?.logoUrl, onSettings: { showSettings = true })
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    profileCard
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
        .navigationDestination(isPresented: $showSettings) { PromoterSettingsView() }
        .task { brand = try? await SupplierRepo().me() }
    }

    private var profileCard: some View {
        VStack(spacing: 16) {
            // Brand logo (PNG). Falls back to an ember flame if none / not loaded.
            ZStack {
                Circle().fill(Theme.nightLift).frame(width: 96, height: 96)
                    .overlay(Circle().stroke(Theme.hairline))
                if let s = brand?.logoUrl, let u = URL(string: s) {
                    AsyncImage(url: u) { img in
                        img.resizable().scaledToFit().padding(20)
                    } placeholder: {
                        ProgressView().tint(Theme.parchmentDim)
                    }
                    .frame(width: 96, height: 96).clipShape(Circle())
                } else {
                    Image(systemName: "flame.fill").font(.system(size: 30)).foregroundStyle(Theme.ember)
                }
            }

            VStack(spacing: 4) {
                Text(brand?.name ?? "Your brand")
                    .font(.cfSerif(28)).foregroundStyle(Theme.parchment)
                if let key = brand?.key {
                    Text("/\(key)").font(.cfMono(12)).foregroundStyle(Theme.parchmentDim)
                }
            }

            VStack(spacing: 0) {
                infoRow("Login", value: email ?? "—")
                divider
                infoRow("Accent") {
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(brandColor).frame(width: 22, height: 14)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.hairline))
                        Text(brand?.color.uppercased() ?? "—")
                            .font(.cfMono(12)).foregroundStyle(Theme.parchment)
                    }
                }
            }
            .padding(.init(top: 6, leading: 14, bottom: 6, trailing: 14))
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.night))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))

            Text("Your logo, name, and colours are managed by Club Fuoco. To change them, contact your Club Fuoco partner.")
                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))
    }

    private func infoRow(_ label: String, value: String) -> some View {
        infoRow(label) { Text(value).font(.cfSans(13)).foregroundStyle(Theme.parchment) }
    }
    private func infoRow<V: View>(_ label: String, @ViewBuilder value: () -> V) -> some View {
        HStack {
            Text(label).font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
            Spacer()
            value()
        }
        .padding(.vertical, 10)
    }
    private var divider: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }

    private var brandColor: Color {
        guard let hex = brand?.color else { return Theme.ember }
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        return UInt32(s, radix: 16).map { Color(hex: $0) } ?? Theme.ember
    }

    private var initials: String {
        guard let name = brand?.name, let first = name.first else { return "" }
        return String(first).uppercased()
    }
    private var email: String? {
        if case .signedIn(let p) = auth.state { return p.email }
        return nil
    }
}
