import SwiftUI

/// Forgot-password flow: email → 6-digit recovery code → new password.
/// Uses Supabase's recovery OTP (see AuthStore.sendPasswordReset /
/// verifyPasswordRecoveryOTP / updatePassword). On success the recovery
/// session is upgraded to a real one and RootView drops the user into the app.
struct ForgotPasswordView: View {
    @Binding var path: [AuthRoute]
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss

    private enum Step { case email, code, newPassword }
    @State private var step: Step = .email
    @State private var email = ""
    @State private var code = ""
    @State private var newPassword = ""
    @State private var showPassword = false
    @State private var submitting = false
    @State private var errorMessage: String?
    @State private var resendCooldown = 0

    private let cooldownSeconds = 30
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BackChevronButton { back() }
                    .padding(.bottom, 24)

                Kicker("N° 01 · " + locale.t("forgot.kicker"))
                    .padding(.bottom, 16)

                (Text(locale.t("forgot.title")).italic()
                    + Text(" \(locale.t("forgot.titleEm"))"))
                    .font(.cfSerif(52))
                    .foregroundStyle(Theme.ink)
                    .padding(.bottom, 10)

                Text(subtitle)
                    .font(.cfSans(13.5))
                    .foregroundStyle(Theme.stone)
                    .padding(.bottom, 36)

                VStack(spacing: 20) {
                    switch step {
                    case .email:       emailStep
                    case .code:        codeStep
                    case .newPassword: passwordStep
                    }

                    if let errorMessage {
                        FormError(message: errorMessage)
                    }

                    PrimaryButton(
                        title: primaryTitle,
                        loading: submitting,
                        disabled: primaryDisabled
                    ) {
                        primary()
                    }
                }
            }
            .padding(24)
        }
        .background(Theme.cream)
        .toolbar(.hidden, for: .navigationBar)
        .onReceive(timer) { _ in
            if resendCooldown > 0 { resendCooldown -= 1 }
        }
    }

    // MARK: Steps

    private var emailStep: some View {
        AuthField(label: locale.t("auth.email")) {
            TextField("you@fuoco.club", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.cfSans(16))
        }
    }

    private var codeStep: some View {
        VStack(spacing: 14) {
            AuthField(label: locale.t("forgot.codeLabel")) {
                TextField("000000", text: $code)
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .font(.cfMono(20))
                    .kerning(6)
            }
            // Resend — disabled during the cooldown window.
            Button {
                resend()
            } label: {
                Text(resendCooldown > 0
                     ? String(format: locale.t("forgot.resendIn"), resendCooldown)
                     : locale.t("forgot.resend"))
                    .font(.cfSans(13))
                    .foregroundStyle(resendCooldown > 0 ? Theme.fadedSand : Theme.wine)
                    .frame(maxWidth: .infinity)
            }
            .disabled(resendCooldown > 0 || submitting)
        }
    }

    private var passwordStep: some View {
        AuthField(label: locale.t("forgot.newPassword")) {
            Group {
                if showPassword {
                    TextField("••••••••", text: $newPassword)
                } else {
                    SecureField("••••••••", text: $newPassword)
                }
            }
            .textContentType(.newPassword)
            .font(.cfSans(16))

            Button { showPassword.toggle() } label: {
                Text(locale.t(showPassword ? "auth.hide" : "auth.show"))
                    .font(.cfMono(10)).kerning(1.6)
                    .foregroundStyle(Theme.wine)
            }
        }
    }

    // MARK: Copy

    private var subtitle: String {
        switch step {
        case .email:       return locale.t("forgot.emailSub")
        case .code:        return String(format: locale.t("forgot.codeSub"), email)
        case .newPassword: return locale.t("forgot.passwordSub")
        }
    }

    private var primaryTitle: String {
        if submitting { return locale.t("forgot.working") }
        switch step {
        case .email:       return locale.t("forgot.sendCode")
        case .code:        return locale.t("forgot.verify")
        case .newPassword: return locale.t("forgot.setPassword")
        }
    }

    private var primaryDisabled: Bool {
        switch step {
        case .email:       return email.isEmpty
        case .code:        return code.count < 6
        case .newPassword: return newPassword.count < 8
        }
    }

    // MARK: Actions

    private func back() {
        switch step {
        case .email:       dismiss()
        case .code:        step = .email; errorMessage = nil
        case .newPassword: step = .code;  errorMessage = nil
        }
    }

    private func primary() {
        switch step {
        case .email:       sendCode()
        case .code:        verifyCode()
        case .newPassword: setPassword()
        }
    }

    private func sendCode() {
        submitting = true
        errorMessage = nil
        Task {
            defer { submitting = false }
            do {
                try await auth.sendPasswordReset(email: email.trimmingCharacters(in: .whitespaces))
                Haptics.tap()
                resendCooldown = cooldownSeconds
                step = .code
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
        }
    }

    /// The resend button — re-requests the recovery code (see explanation to
    /// the user). Gated by the on-screen cooldown; server-side rate limiting
    /// is the next task.
    private func resend() {
        submitting = true
        errorMessage = nil
        Task {
            defer { submitting = false }
            do {
                try await auth.sendPasswordReset(email: email.trimmingCharacters(in: .whitespaces))
                Haptics.success()
                resendCooldown = cooldownSeconds
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
        }
    }

    private func verifyCode() {
        submitting = true
        errorMessage = nil
        Task {
            defer { submitting = false }
            do {
                try await auth.verifyPasswordRecoveryOTP(
                    email: email.trimmingCharacters(in: .whitespaces),
                    code: code.trimmingCharacters(in: .whitespaces))
                Haptics.tap()
                step = .newPassword
            } catch {
                Haptics.error()
                errorMessage = locale.t("forgot.codeError")
            }
        }
    }

    private func setPassword() {
        submitting = true
        errorMessage = nil
        Task {
            defer { submitting = false }
            do {
                try await auth.updatePassword(newPassword)
                Haptics.success()
                // RootView switches to the app once onboardingInProgress clears.
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
        }
    }
}
