import SwiftUI

struct SignUpView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Field?
    enum Field { case name, email, password, instagram, clubs, bio, code }

    enum Step: Int, CaseIterable { case account, pitch, otp }
    @State private var step: Step = .account

    // Account
    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    // Pitch
    @State private var instagram = ""
    @State private var experience = ""
    // Clubs (multi-select + Other)
    @State private var allClubs: [Club] = []
    @State private var selectedClubIds: Set<UUID> = []
    @State private var otherClubs = ""
    @State private var showClubPicker = false

    private var selectedClubNames: [String] {
        allClubs.filter { selectedClubIds.contains($0.id) }.map(\.name)
    }
    private var clubsValue: String {
        var parts = selectedClubNames
        let other = otherClubs.trimmingCharacters(in: .whitespaces)
        if !other.isEmpty { parts.append(other) }
        return parts.joined(separator: ", ")
    }
    // OTP
    @State private var code = ""

    @State private var submitting = false
    @State private var error: String?

    private let repo = PromoterRepo()

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            VStack(spacing: 0) {
                topBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        header
                        switch step {
                        case .account: accountPage
                        case .pitch:   pitchPage
                        case .otp:     otpPage
                        }
                        if let error {
                            Text(error).font(.cfSans(13)).foregroundStyle(Theme.wine)
                        }
                        Spacer(minLength: 40)
                    }
                    .padding(24)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar { ToolbarItemGroup(placement: .keyboard) {
            Button("Done") { focused = nil }.foregroundStyle(Theme.ember); Spacer() } }
        .task { if allClubs.isEmpty { allClubs = (try? await repo.barcelonaClubs()) ?? [] } }
        .sheet(isPresented: $showClubPicker) {
            ClubMultiSelectSheet(clubs: allClubs, selected: $selectedClubIds, other: $otherClubs)
                .presentationBackground(Theme.night)
        }
    }

    // MARK: Chrome

    private var topBar: some View {
        HStack {
            Button { back() } label: {
                Image(systemName: "chevron.left").foregroundStyle(Theme.parchment)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Theme.nightLift))
            }
            Spacer()
            // Step dots
            HStack(spacing: 6) {
                ForEach(Step.allCases, id: \.rawValue) { s in
                    Circle()
                        .fill(s.rawValue <= step.rawValue ? Theme.ember : Theme.parchmentFaint)
                        .frame(width: 7, height: 7)
                }
            }
            Spacer()
            // Balance the back button
            Color.clear.frame(width: 40, height: 40)
        }
        .padding(.horizontal, 16).padding(.top, 8)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker("Step \(step.rawValue + 1) of 3", color: Theme.flame)
            Text(title).font(.cfSerif(38)).foregroundStyle(Theme.parchment)
            Text(subtitle).font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
        }
    }

    private var title: String {
        switch step {
        case .account: return "Create your account"
        case .pitch:   return "About your nights"
        case .otp:     return "Verify your email"
        }
    }
    private var subtitle: String {
        switch step {
        case .account: return "Start with the basics."
        case .pitch:   return "We onboard promoters by hand — tell us who you are."
        case .otp:     return "Enter the 6-digit code we emailed to \(email)."
        }
    }

    // MARK: Pages

    private var accountPage: some View {
        VStack(alignment: .leading, spacing: 20) {
            field("Full name", text: $fullName, placeholder: "Your name", focus: .name)
            field("Email", text: $email, placeholder: "you@email.com", focus: .email, lower: true, email: true)
            secureField("Password", text: $password)
            EmberPillButton(title: "Continue", trailingIcon: "chevron.right") { continueFromAccount() }
                .padding(.top, 4)
            signInLink
        }
    }

    private var pitchPage: some View {
        VStack(alignment: .leading, spacing: 20) {
            field("Instagram (required)", text: $instagram, placeholder: "@yourhandle",
                  focus: .instagram, lower: true)
            Text("We verify promoters by Instagram — 5,000+ followers required.")
                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)

            VStack(alignment: .leading, spacing: 6) {
                Kicker("Clubs / scenes you work")
                Button {
                    Haptics.tap(); focused = nil; showClubPicker = true
                } label: {
                    HStack {
                        Text(clubsValue.isEmpty ? "Select clubs" : clubsValue)
                            .font(.cfSans(16))
                            .foregroundStyle(clubsValue.isEmpty ? Theme.parchmentDim : Theme.parchment)
                            .lineLimit(2).multilineTextAlignment(.leading)
                        Spacer()
                        Image(systemName: "chevron.down").font(.system(size: 13)).foregroundStyle(Theme.parchmentDim)
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Kicker("A bit about you (optional)")
                TextField("", text: $experience,
                          prompt: Text("Crowd size, who you work with…").foregroundStyle(Theme.parchmentDim),
                          axis: .vertical)
                    .lineLimit(2...4)
                    .font(.cfSans(15)).foregroundStyle(Theme.parchment).focused($focused, equals: .bio)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.parchment.opacity(0.06)))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
            }
            EmberPillButton(title: "Create account", loading: submitting) { Task { await createAccount() } }
                .padding(.top, 4)
        }
    }

    private var otpPage: some View {
        VStack(alignment: .leading, spacing: 22) {
            TextField("", text: $code, prompt: Text("123456").foregroundStyle(Theme.parchmentFaint))
                .keyboardType(.numberPad)
                .font(.cfSerif(52)).foregroundStyle(Theme.parchment).kerning(12)
                .multilineTextAlignment(.center)
                .focused($focused, equals: .code)
                .padding(.vertical, 18).frame(maxWidth: .infinity)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
            EmberPillButton(title: "Verify & apply", loading: submitting) { Task { await verify() } }
            Button("Resend code") { Task { try? await auth.resendSignupOTP(email: email) } }
                .font(.cfMono(11)).kerning(1.2).foregroundStyle(Theme.ember)
                .frame(maxWidth: .infinity)
        }
    }

    private var signInLink: some View {
        Button("Already have an account? Sign in") { dismiss() }
            .font(.cfMono(11)).kerning(1.2).foregroundStyle(Theme.parchmentDim)
            .frame(maxWidth: .infinity).padding(.top, 8)
    }

    // MARK: Navigation / actions

    private func back() {
        error = nil
        switch step {
        case .account: dismiss()
        case .pitch:   withAnimation { step = .account }
        case .otp:     withAnimation { step = .pitch }
        }
    }

    private func continueFromAccount() {
        let name = fullName.trimmingCharacters(in: .whitespaces)
        let mail = email.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !mail.isEmpty, password.count >= 6 else {
            error = "Enter your name, email, and a password (6+ characters)."; return
        }
        error = nil
        withAnimation { step = .pitch }
    }

    private func createAccount() async {
        guard !instagram.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Add your Instagram handle — we verify promoters by Instagram."; return
        }
        guard !clubsValue.isEmpty else {
            error = "Select at least one club, or add your own under Other."; return
        }
        submitting = true; error = nil
        do {
            let needsOTP = try await auth.signUp(
                email: email.trimmingCharacters(in: .whitespaces), password: password,
                fullName: fullName.trimmingCharacters(in: .whitespaces))
            Haptics.success()
            if needsOTP { withAnimation { step = .otp } } else { await finalize() }
        } catch AuthStore.SignUpError.emailTaken {
            error = "That email already has an account — sign in instead."
        } catch {
            self.error = "Couldn't create your account. Try again."
        }
        submitting = false
    }

    private func verify() async {
        let c = code.trimmingCharacters(in: .whitespaces)
        guard c.count >= 6 else { error = "Enter the 6-digit code."; return }
        submitting = true; error = nil
        do {
            try await auth.verifySignupOTP(email: email, code: c)
            await finalize()
        } catch {
            self.error = "That code didn't work. Check your email and try again."
        }
        submitting = false
    }

    /// Mark this a promoter account, generate the IG code, file the application.
    private func finalize() async {
        _ = try? await repo.finalizePromoterSignup(
            instagram: instagram, clubs: clubs, experience: experience)
        await auth.refresh()
        dismiss()
    }

    // MARK: Fields

    @ViewBuilder
    private func field(_ label: String, text: Binding<String>, placeholder: String,
                       focus: Field, lower: Bool = false, email: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            TextField("", text: text, prompt: Text(placeholder).foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(16)).foregroundStyle(Theme.parchment).focused($focused, equals: focus)
                .textInputAutocapitalization(lower ? .never : .words)
                .autocorrectionDisabled(lower)
                .keyboardType(email ? .emailAddress : .default)
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
        }
    }

    private func secureField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            SecureField("", text: text, prompt: Text("6+ characters").foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(16)).foregroundStyle(Theme.parchment).focused($focused, equals: .password)
                .textContentType(.newPassword)
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
        }
    }
}
