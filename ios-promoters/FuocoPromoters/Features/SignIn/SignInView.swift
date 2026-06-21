import SwiftUI

struct SignInView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var email = ""
    @State private var password = ""
    @State private var submitting = false

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 14) {
                    Text("Fuoco")
                        .font(.cfSerif(64))
                        .foregroundStyle(Theme.parchment)

                    HStack {
                        Capsule().stroke(Theme.flame.opacity(0.6), lineWidth: 1)
                            .frame(width: 168, height: 32)
                            .overlay(Kicker("For Promoters", color: Theme.flame))
                    }
                }

                VStack(alignment: .leading, spacing: 18) {
                    TextField("", text: $email, prompt: Text("Email address")
                        .foregroundStyle(Theme.parchmentDim))
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        .foregroundStyle(Theme.parchment)
                        .font(.cfSans(17))
                        .padding(.vertical, 14)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Theme.parchmentFaint).frame(height: 1)
                        }

                    SecureField("", text: $password, prompt: Text("Password")
                        .foregroundStyle(Theme.parchmentDim))
                        .textContentType(.password)
                        .foregroundStyle(Theme.parchment)
                        .font(.cfSans(17))
                        .padding(.vertical, 14)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Theme.parchmentFaint).frame(height: 1)
                        }
                }
                .padding(.horizontal, 28)

                EmberPillButton(title: "Sign in", loading: submitting) {
                    submit()
                }
                .padding(.horizontal, 28)

                if let err = auth.errorMessage {
                    Text(err)
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.wine)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)
                }

                Spacer()

                Text("Not a promoter? Apply →")
                    .font(.cfMono(11))
                    .kerning(1.5)
                    .foregroundStyle(Theme.parchmentDim)
                    .padding(.bottom, 12)
            }
        }
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty else { return }
        submitting = true
        Task {
            await auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            submitting = false
        }
    }
}
