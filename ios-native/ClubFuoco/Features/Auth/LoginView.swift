import SwiftUI

/// Native port of (auth)/login — cream cinema theme, mono kicker, serif
/// headline, white fields with SHOW/HIDE, wine CTA, OAuth buttons below.
struct LoginView: View {
    @Binding var path: [AuthRoute]
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var submitting = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BackChevronButton { dismiss() }
                    .padding(.bottom, 24)

                Kicker("N° 01 · Accesso")
                    .padding(.bottom, 16)

                (Text(locale.t("login.welcome")).italic()
                    + Text(" \(locale.t("login.welcomeBack"))"))
                    .font(.cfSerif(52))
                    .foregroundStyle(Theme.ink)
                    .padding(.bottom, 10)

                Text(locale.t("login.subtitle"))
                    .font(.cfSans(13.5))
                    .foregroundStyle(Theme.stone)
                    .padding(.bottom, 36)

                VStack(spacing: 20) {
                    AuthField(label: locale.t("auth.email")) {
                        TextField("you@fuoco.club", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.cfSans(16))
                    }

                    AuthField(label: locale.t("auth.password")) {
                        Group {
                            if showPassword {
                                TextField("••••••••", text: $password)
                            } else {
                                SecureField("••••••••", text: $password)
                            }
                        }
                        .textContentType(.password)
                        .font(.cfSans(16))

                        Button {
                            showPassword.toggle()
                        } label: {
                            Text(locale.t(showPassword ? "auth.hide" : "auth.show"))
                                .font(.cfMono(10))
                                .kerning(1.6)
                                .foregroundStyle(Theme.wine)
                        }
                    }

                    if let errorMessage {
                        FormError(message: errorMessage)
                    }

                    // Present on web but inert there too — kept for parity.
                    Text(locale.t("login.forgotPassword"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.wine)

                    PrimaryButton(
                        title: locale.t(submitting ? "login.signingIn" : "login.signIn"),
                        loading: submitting,
                        disabled: email.isEmpty || password.isEmpty
                    ) {
                        submit()
                    }
                }

                OAuthButtonsView(path: $path)
                    .padding(.top, 24)

                HStack(spacing: 4) {
                    Text(locale.t("login.noAccount"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.stone)
                    Button {
                        path.append(.signup)
                    } label: {
                        Text(locale.t("login.createOne"))
                            .font(.cfSans(13))
                            .foregroundStyle(Theme.wine)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
            }
            .padding(24)
        }
        .background(Theme.cream)
        .scrollDismissesKeyboard(.interactively)
        .toolbar(.hidden, for: .navigationBar)
    }

    private func submit() {
        submitting = true
        errorMessage = nil
        Task {
            do {
                try await auth.signIn(email: email, password: password)
                Haptics.success()
                // RootView switches to MainTabView on the signedIn event.
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            submitting = false
        }
    }
}
