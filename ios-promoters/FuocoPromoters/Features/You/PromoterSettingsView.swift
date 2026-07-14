import SwiftUI

/// Full settings list for a promoter account. Every row is wired to a real
/// action — account (password reset, IG status), preferences (haptics, system
/// permissions), payment (Stripe billing portal), support/legal links, and the
/// danger zone (sign out, delete account). Reached from the gear on the You tab.
struct PromoterSettingsView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    @State private var hapticsOn = Haptics.enabled
    @State private var igVerified: Bool?          // nil = unknown/loading
    @State private var igStatus: String?

    // Async action state
    @State private var sendingReset = false
    @State private var resetSent = false
    @State private var openingBilling = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var alert: AlertInfo?

    private let repo = PromoterRepo()

    private struct AlertInfo: Identifiable { let id = UUID(); let title: String; let message: String }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(v) (\(b))"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                account
                preferences
                payment
                support
                about
                danger
            }
            .padding(20)
            .padding(.bottom, 40)
        }
        .background(Theme.night.ignoresSafeArea())
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.night, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            if let app = try? await repo.myApplication() {
                igVerified = app.igVerified
                igStatus = app.status
            }
        }
        .alert(item: $alert) { info in
            Alert(title: Text(info.title), message: Text(info.message), dismissButton: .default(Text("OK")))
        }
        .alert("Delete account?", isPresented: $confirmDelete) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { Task { await deleteAccount() } }
        } message: {
            Text("This permanently deletes your promoter account, guestlists, and nights. This can't be undone.")
        }
        .overlay {
            if deleting {
                ZStack { Color.black.opacity(0.5).ignoresSafeArea(); ProgressView().tint(.white) }
            }
        }
    }

    // MARK: - Sections

    private var account: some View {
        section("Account") {
            row(icon: "envelope", title: "Email", trailing: {
                Text(auth.email ?? "—").font(.cfSans(14)).foregroundStyle(Theme.parchmentDim).lineLimit(1)
            })
            divider
            actionRow(icon: "key", title: sendingReset ? "Sending…" : (resetSent ? "Email sent ✓" : "Reset password"),
                      disabled: sendingReset || resetSent) {
                Task { await sendReset() }
            }
            divider
            row(icon: "checkmark.seal", title: "Instagram", trailing: {
                Text(igLabel)
                    .font(.cfMono(10, weight: .medium)).kerning(1)
                    .foregroundStyle(igVerified == true ? Theme.emberCream : Theme.flame)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Capsule().fill(igVerified == true ? Theme.ember : Theme.ember.opacity(0.18)))
            })
        }
    }

    private var preferences: some View {
        section("Preferences") {
            HStack(spacing: 14) {
                icon("hand.tap")
                Text("Haptic feedback").font(.cfSans(15)).foregroundStyle(Theme.parchment)
                Spacer()
                Toggle("", isOn: $hapticsOn)
                    .labelsHidden()
                    .tint(Theme.ember)
                    .onChange(of: hapticsOn) { _, v in Haptics.enabled = v; if v { Haptics.tap() } }
            }
            .padding(.vertical, 12).padding(.horizontal, 14)
            divider
            actionRow(icon: "gearshape.2", title: "System permissions", chevron: true) {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
        }
    }

    private var payment: some View {
        section("Payment") {
            actionRow(icon: "creditcard", title: openingBilling ? "Opening…" : "Payment method",
                      chevron: true, disabled: openingBilling) {
                Task { await openBilling() }
            }
        }
        .overlay(alignment: .bottomLeading) {
            Text("Used only for front-page promotion. Nothing else is charged.")
                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
                .padding(.horizontal, 4).offset(y: 22)
        }
        .padding(.bottom, 20)
    }

    private var support: some View {
        section("Support & legal") {
            actionRow(icon: "envelope.badge", title: "Contact support", chevron: true) {
                if let url = URL(string: "mailto:partners@clubfuoco.com?subject=Fuoco%20Promoter%20Support") {
                    openURL(url)
                }
            }
            divider
            actionRow(icon: "hand.raised", title: "Privacy Policy", chevron: true) {
                openURL(URL(string: "https://clubfuoco.com/legal/privacy")!)
            }
            divider
            actionRow(icon: "doc.text", title: "Terms of Service", chevron: true) {
                openURL(URL(string: "https://clubfuoco.com/legal/terms")!)
            }
        }
    }

    private var about: some View {
        section("About") {
            row(icon: "info.circle", title: "Version", trailing: {
                Text(appVersion).font(.cfMono(12)).foregroundStyle(Theme.parchmentDim)
            })
        }
    }

    private var danger: some View {
        VStack(spacing: 12) {
            Button { Task { await auth.signOut() } } label: {
                Text("Sign out")
                    .font(.cfMono(11, weight: .medium)).kerning(2)
                    .foregroundStyle(Theme.ember)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .overlay(Capsule().stroke(Theme.ember.opacity(0.6)))
            }
            Button { confirmDelete = true } label: {
                Text("Delete account")
                    .font(.cfMono(11, weight: .medium)).kerning(2)
                    .foregroundStyle(Theme.wine)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .overlay(Capsule().stroke(Theme.wine.opacity(0.5)))
            }
            .disabled(deleting)
        }
        .padding(.top, 4)
    }

    // MARK: - Actions

    private func sendReset() async {
        sendingReset = true
        defer { sendingReset = false }
        do {
            try await auth.sendPasswordReset()
            resetSent = true
            Haptics.success()
        } catch {
            Haptics.error()
            alert = AlertInfo(title: "Couldn't send", message: error.localizedDescription)
        }
    }

    private func openBilling() async {
        openingBilling = true
        defer { openingBilling = false }
        if let url = try? await repo.billingSetupURL() {
            openURL(url)
        } else {
            alert = AlertInfo(title: "Unavailable", message: "Couldn't open the billing portal. Try again.")
        }
    }

    private func deleteAccount() async {
        deleting = true
        defer { deleting = false }
        do {
            try await auth.deleteAccount()
            Haptics.success()
            // RootView switches to sign-in on state change; dismiss the sheet.
            dismiss()
        } catch {
            Haptics.error()
            alert = AlertInfo(title: "Couldn't delete", message: error.localizedDescription)
        }
    }

    private var igLabel: String {
        if igVerified == true { return "VERIFIED" }
        if igStatus == "approved" { return "VERIFIED" }
        return "PENDING"
    }

    // MARK: - Building blocks

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker(title, color: Theme.parchmentDim)
            VStack(spacing: 0) { content() }
                .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))
        }
    }

    private func row<Trailing: View>(icon name: String, title: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 14) {
            icon(name)
            Text(title).font(.cfSans(15)).foregroundStyle(Theme.parchment)
            Spacer()
            trailing()
        }
        .padding(.vertical, 12).padding(.horizontal, 14)
    }

    private func actionRow(icon name: String, title: String, chevron: Bool = false,
                           disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 14) {
                icon(name)
                Text(title).font(.cfSans(15)).foregroundStyle(Theme.parchment)
                Spacer()
                if chevron {
                    Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.parchmentDim)
                }
            }
            .padding(.vertical, 12).padding(.horizontal, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func icon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 16))
            .foregroundStyle(Theme.flame)
            .frame(width: 24)
    }

    private var divider: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 52)
    }
}
