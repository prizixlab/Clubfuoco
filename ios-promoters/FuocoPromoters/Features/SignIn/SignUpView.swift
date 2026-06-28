import SwiftUI

struct SignUpView: View {
    @EnvironmentObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    enum Step { case details, otp }
    @State private var step: Step = .details

    // Account
    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    // Pitch (promoter application)
    @State private var instagram = ""
    @State private var clubs = ""
    @State private var experience = ""
    // OTP
    @State private var code = ""

    @State private var submitting = false
    @State private var error: String?

    private let repo = PromoterRepo()

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    if step == .details { detailsForm } else { otpForm }
                    if let error {
                        Text(error).font(.cfSans(13)).foregroundStyle(Theme.wine)
                    }
                    Button("Already have an account? Sign in") { dismiss() }
                        .font(.cfMono(11)).kerning(1.2)
                        .foregroundStyle(Theme.parchmentDim)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                    Spacer(minLength: 40)
                }
                .padding(24)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar { ToolbarItemGroup(placement: .keyboard) {
            Button("Done") { focused = false }.foregroundStyle(Theme.ember); Spacer() } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker("Fuoco for Promoters", color: Theme.ember)
            Text(step == .details ? "Create your account" : "Verify your email")
                .font(.cfSerif(38))
                .foregroundStyle(Theme.parchment)
            Text(step == .details
                 ? "Tell us who you are and about your nights — we onboard promoters by hand."
                 : "Enter the 6-digit code we just emailed to \(email).")
                .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
        }
    }

    // MARK: Details

    private var detailsForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            field("Full name", text: $fullName, placeholder: "Your name")
            field("Email", text: $email, placeholder: "you@email.com", lower: true, email: true)
            secureField("Password", text: $password)

            Divider().background(Theme.hairline).padding(.vertical, 4)
            Kicker("About you")
            field("Instagram (required)", text: $instagram, placeholder: "@yourhandle", lower: true)
            Text("We verify promoters by Instagram — 5,000+ followers required.")
                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
            field("Clubs / scenes you work", text: $clubs, placeholder: "e.g. Opium, techno nights")
            VStack(alignment: .leading, spacing: 6) {
                Kicker("A bit about you (optional)")
                TextField("", text: $experience,
                          prompt: Text("Crowd size, who you work with…").foregroundStyle(Theme.parchmentDim),
                          axis: .vertical)
                    .lineLimit(2...4)
                    .font(.cfSans(15)).foregroundStyle(Theme.parchment).focused($focused)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.parchment.opacity(0.06)))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
            }

            EmberPillButton(title: "Create account", loading: submitting) { Task { await createAccount() } }
                .padding(.top, 4)
        }
    }

    private func createAccount() async {
        let name = fullName.trimmingCharacters(in: .whitespaces)
        let mail = email.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !mail.isEmpty, password.count >= 6 else {
            error = "Enter your name, email, and a password (6+ characters)."; return
        }
        guard !instagram.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Add your Instagram handle — we verify promoters by Instagram."; return
        }
        guard !clubs.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Tell us which clubs or scenes you work."; return
        }
        submitting = true; error = nil
        do {
            let needsOTP = try await auth.signUp(email: mail, password: password, fullName: name)
            Haptics.success()
            if needsOTP { step = .otp } else { await fileApplication() }
        } catch AuthStore.SignUpError.emailTaken {
            error = "That email already has an account — sign in instead."
        } catch {
            self.error = "Couldn't create your account. Try again."
        }
        submitting = false
    }

    // MARK: OTP

    private var otpForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            TextField("", text: $code, prompt: Text("123456").foregroundStyle(Theme.parchmentDim))
                .keyboardType(.numberPad)
                .font(.cfSerif(34)).foregroundStyle(Theme.parchment)
                .kerning(8)
                .focused($focused)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }

            EmberPillButton(title: "Verify & apply", loading: submitting) { Task { await verify() } }

            Button("Resend code") { Task { try? await auth.resendSignupOTP(email: email) } }
                .font(.cfMono(11)).kerning(1.2).foregroundStyle(Theme.ember)
                .frame(maxWidth: .infinity)
        }
    }

    private func verify() async {
        let c = code.trimmingCharacters(in: .whitespaces)
        guard c.count >= 6 else { error = "Enter the 6-digit code."; return }
        submitting = true; error = nil
        do {
            try await auth.verifySignupOTP(email: email, code: c)
            await fileApplication()
        } catch {
            self.error = "That code didn't work. Check your email and try again."
        }
        submitting = false
    }

    /// Once the email is verified, finalize: mark this a promoter account,
    /// generate the IG verification code, file the application. RootView then
    /// shows the locked verification screen.
    private func fileApplication() async {
        _ = try? await repo.finalizePromoterSignup(
            instagram: instagram, clubs: clubs, experience: experience)
        // Re-resolve the profile so account_kind = 'promoter' takes effect and
        // RootView routes to verification.
        await auth.refresh()
        dismiss()
    }

    // MARK: Fields

    @ViewBuilder
    private func field(_ label: String, text: Binding<String>, placeholder: String,
                       lower: Bool = false, email: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            TextField("", text: text, prompt: Text(placeholder).foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(16)).foregroundStyle(Theme.parchment).focused($focused)
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
                .font(.cfSans(16)).foregroundStyle(Theme.parchment).focused($focused)
                .textContentType(.newPassword)
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
        }
    }
}
