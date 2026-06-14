import SwiftUI
import Supabase

/// Native port of (auth)/signup — three-step wizard (details → birthday →
/// membership) with the email-OTP verification overlay between details and
/// birthday. Club/DJ accounts are "coming soon" (role chooser shows them
/// disabled), matching the web wizard which starts at step 2 with
/// accountType = user.
struct SignupView: View {
    @Binding var path: [AuthRoute]
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss

    private enum Step: Int {
        case details = 2, birthday = 3, membership = 4
    }

    @State private var step: Step = .details
    @State private var showRoleChooser = false

    // Details
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var tosAccepted = false

    // OTP
    @State private var verifying = false
    @State private var otpCode = ""
    @State private var resent = false

    // Birthday — same defaults as the web wizard (day 17, May, 25 years ago)
    private static let currentYear = Calendar.current.component(.year, from: Date())
    @State private var bDay = 17
    @State private var bMonth = 5
    @State private var bYear = currentYear - 25

    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if verifying {
                otpOverlay
            } else {
                wizard
            }
        }
        .background(Theme.cream)
        .toolbar(.hidden, for: .navigationBar)
    }

    // ── Wizard frame ──────────────────────────────────────────────────────────

    private var wizard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    BackChevronButton { goBack() }
                    Spacer()
                    Text(String(format: locale.t("signup.stepLabel"), stepNumber).uppercased())
                        .font(.cfMono(8.5))
                        .kerning(1.9)
                        .foregroundStyle(Theme.fadedSand)
                }
                .padding(.bottom, 12)

                SegmentedProgress(step: step.rawValue - 1, total: 3)
                    .padding(.bottom, 16)

                switch step {
                case .details: detailsStep
                case .birthday: birthdayStep
                case .membership: membershipStep
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var stepNumber: String {
        switch step {
        case .details: return "01"
        case .birthday: return "02"
        case .membership: return "03"
        }
    }

    private func goBack() {
        switch step {
        case .details: dismiss()
        case .birthday: step = .details
        case .membership: step = .birthday
        }
    }

    // ── Step 1 of 3: details ─────────────────────────────────────────────────

    private var detailsStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !showRoleChooser {
                Button {
                    showRoleChooser = true
                } label: {
                    (Text(locale.t("signup.areYouArtist")).bold().foregroundColor(Theme.ink)
                        + Text(" ")
                        + Text(locale.t("signup.tapHere")).underline().foregroundColor(Theme.wine))
                        .font(.cfSans(12.5))
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(Theme.cream.opacity(0.9), in: .rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x2A1F12).opacity(0.18)))
                }
                .padding(.bottom, 8)
            } else {
                roleChooser
                    .padding(.bottom, 8)
            }

            Kicker("N° 02 · I tuoi dati")

            (Text(locale.t("signup.yourDetails")) + Text(" ") + Text(locale.t("signup.yourDetailsEm")).italic())
                .font(.cfSerif(44))
                .foregroundStyle(Theme.ink)

            Text(locale.t("signup.detailsSubtitle"))
                .font(.cfSans(13.5))
                .foregroundStyle(Theme.stone)
                .padding(.bottom, 12)

            HStack(spacing: 10) {
                AuthField(label: locale.t("signup.firstName")) {
                    TextField("Marco", text: $firstName)
                        .textContentType(.givenName)
                        .font(.cfSans(16))
                }
                AuthField(label: locale.t("signup.lastName")) {
                    TextField("Bernardi", text: $lastName)
                        .textContentType(.familyName)
                        .font(.cfSans(16))
                }
            }

            AuthField(label: locale.t("auth.email"), error: errorMentionsEmail) {
                TextField("you@fuoco.club", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.cfSans(16))
            }

            VStack(alignment: .leading, spacing: 6) {
                AuthField(label: locale.t("auth.password")) {
                    Group {
                        if showPassword {
                            TextField("••••••••", text: $password)
                        } else {
                            SecureField("••••••••", text: $password)
                        }
                    }
                    .textContentType(.newPassword)
                    .font(.cfSans(16))

                    Button { showPassword.toggle() } label: {
                        Text(locale.t(showPassword ? "auth.hideLower" : "auth.showLower"))
                            .font(.cfMono(10))
                            .kerning(1.6)
                            .foregroundStyle(Theme.wine)
                    }
                }
                Kicker(locale.t("signup.passwordHint"), color: Theme.fadedSand)
            }

            if let errorMessage {
                VStack(alignment: .leading, spacing: 4) {
                    FormError(message: errorMessage)
                    if errorMentionsEmail {
                        Button {
                            path.append(.login)
                        } label: {
                            Text(locale.t("signup.trySigningIn"))
                                .font(.cfSans(12))
                                .underline()
                                .foregroundStyle(Theme.wine)
                        }
                    }
                }
            }

            // ToS acceptance
            HStack(alignment: .top, spacing: 10) {
                Button {
                    tosAccepted.toggle()
                    Haptics.tap()
                } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(tosAccepted ? Theme.wine : .clear)
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(tosAccepted ? Theme.wine : Theme.fadedSand, lineWidth: 1.5)
                        if tosAccepted {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(width: 20, height: 20)
                }

                (Text(locale.t("signup.tosPrefix")) + Text(" ")
                    + Text(locale.t("signup.termsOfUse")).underline().foregroundColor(Theme.wine)
                    + Text(" \(locale.t("signup.and")) ")
                    + Text(locale.t("signup.privacyPolicy")).underline().foregroundColor(Theme.wine)
                    + Text("."))
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.fadedSand)
            }
            .padding(.top, 4)

            PrimaryButton(
                title: locale.t("signup.createAccount"),
                loading: loading,
                disabled: firstName.isEmpty || lastName.isEmpty || email.isEmpty || password.count < 8
            ) {
                submitDetails()
            }
            .padding(.top, 8)

            OAuthButtonsView(path: $path)
                .padding(.top, 8)

            HStack(spacing: 4) {
                Text(locale.t("signup.alreadyMember"))
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.stone)
                Button {
                    path.append(.login)
                } label: {
                    Text(locale.t("signup.signInArrow"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.wine)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
    }

    private var errorMentionsEmail: Bool {
        errorMessage?.lowercased().contains("email") ?? false
    }

    private var roleChooser: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(locale.t("signup.whichAreYou"))
            ForEach([("Locale", "Club / Venue"), ("Artista", "DJ / Artist")], id: \.0) { name, sub in
                HStack {
                    Text(name)
                        .font(.cfSerif(20, italic: true))
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    Text(locale.t("signup.comingSoon").uppercased())
                        .font(.cfMono(8.5))
                        .kerning(1.2)
                        .foregroundStyle(Theme.stone)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .background(Color(hex: 0x2A1F12).opacity(0.07), in: .capsule)
                }
                .padding(14)
                .background(Color.white, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x2A1F12).opacity(0.18)))
                .opacity(0.55)
                .accessibilityHint(sub)
            }
            Text(locale.t("signup.clubArtistNotOpen"))
                .font(.cfSans(12))
                .foregroundStyle(Theme.stone)
            Button {
                showRoleChooser = false
            } label: {
                Kicker(locale.t("signup.justNightsOut"), color: Theme.stone)
            }
            .padding(.top, 2)
        }
    }

    private func submitDetails() {
        guard tosAccepted else {
            errorMessage = locale.t("signup.tosError")
            return
        }
        loading = true
        errorMessage = nil
        Task {
            do {
                let needsOTP = try await auth.signUp(
                    email: email, password: password,
                    firstName: firstName, lastName: lastName
                )
                if needsOTP {
                    otpCode = ""
                    verifying = true
                } else {
                    step = .birthday
                }
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            loading = false
        }
    }

    // ── OTP overlay ───────────────────────────────────────────────────────────

    private var otpOverlay: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BackChevronButton {
                    verifying = false
                    errorMessage = nil
                }
                .padding(.bottom, 32)

                Kicker("N° 02 · Verifica email")
                    .padding(.bottom, 16)

                (Text(locale.t("otp.title")) + Text(" ") + Text(locale.t("otp.titleEm")).italic())
                    .font(.cfSerif(44))
                    .foregroundStyle(Theme.ink)
                    .padding(.bottom, 12)

                Text(String(format: locale.t("otp.body"), email))
                    .font(.cfSans(14))
                    .foregroundStyle(Theme.stone)
                    .padding(.bottom, 28)

                TextField("00000000", text: $otpCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .font(.cfSerif(34))
                    .kerning(8)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 18)
                    .background(Color.white, in: .rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                    .onChange(of: otpCode) { _, new in
                        otpCode = String(new.filter(\.isNumber).prefix(8))
                    }
                    .padding(.bottom, 20)

                if let errorMessage {
                    FormError(message: errorMessage)
                        .padding(.bottom, 20)
                }

                PrimaryButton(
                    title: locale.t(loading ? "otp.verifying" : "otp.verify"),
                    loading: loading,
                    disabled: otpCode.count < 6
                ) {
                    submitOTP()
                }
                .padding(.bottom, 12)

                Button {
                    resendOTP()
                } label: {
                    Text(locale.t(resent ? "otp.resent" : "otp.resend"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.fadedSand)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func submitOTP() {
        loading = true
        errorMessage = nil
        Task {
            do {
                try await auth.verifySignupOTP(email: email, code: otpCode)
                Haptics.success()
                verifying = false
                step = .birthday
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            loading = false
        }
    }

    private func resendOTP() {
        errorMessage = nil
        Task {
            do {
                try await auth.resendSignupOTP(email: email)
                resent = true
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    // ── Step 2 of 3: birthday (18+) ───────────────────────────────────────────

    private static let monthsIT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
                                   "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]

    private var monthNames: [String] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale)
        return formatter.monthSymbols
    }

    private var birthdayStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "calendar")
                .font(.system(size: 26))
                .foregroundStyle(Theme.fadedSand)
                .frame(width: 64, height: 64)
                .background(Color.white, in: .rect(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Theme.hairline))
                .padding(.bottom, 8)

            Kicker("N° 03 · Compleanno")

            (Text(locale.t("signup.whensBirthday")) + Text("\n") + Text(locale.t("signup.birthday")).italic())
                .font(.cfSerif(44))
                .foregroundStyle(Theme.ink)

            Text(locale.t("signup.birthdaySubtitle"))
                .font(.cfSans(13.5))
                .foregroundStyle(Theme.stone)
                .padding(.bottom, 8)

            // Native wheels replace the hand-rolled DrumPicker
            HStack(spacing: 0) {
                wheel(locale.t("signup.day"), selection: $bDay, values: Array(1...31)) { String($0) }
                wheel(locale.t("signup.month"), selection: $bMonth, values: Array(1...12)) { monthNames[$0 - 1] }
                wheel(locale.t("signup.year"), selection: $bYear, values: Array((Self.currentYear - 100)...(Self.currentYear - 17)).reversed()) { String($0) }
            }
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))

            // Selected date, Italian serif line — brand quirk kept from web
            Text("\(bDay) \(Self.monthsIT[bMonth - 1]) \(bYear)")
                .font(.cfSerif(16, italic: true))
                .foregroundStyle(Theme.wine)
                .frame(maxWidth: .infinity)

            if let errorMessage {
                FormError(message: errorMessage)
            }

            PrimaryButton(title: locale.t("signup.continue")) {
                submitBirthday(skip: false)
            }
            .padding(.top, 8)

            Button {
                submitBirthday(skip: true)
            } label: {
                Text(locale.t("signup.skipForNow"))
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func wheel<V: Hashable>(_ label: String, selection: Binding<V>, values: [V], format: @escaping (V) -> String) -> some View {
        VStack(spacing: 4) {
            Kicker(label, color: Theme.fadedSand, size: 9)
            Picker(label, selection: selection) {
                ForEach(values, id: \.self) { v in
                    Text(format(v))
                        .font(.cfSerif(20))
                        .tag(v)
                }
            }
            .pickerStyle(.wheel)
            .frame(height: 160)
            .clipped()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func submitBirthday(skip: Bool) {
        errorMessage = nil
        if skip {
            step = .membership
            return
        }
        // 18+ check — the DB trigger enforces this too
        var age = Self.currentYear - bYear
        let now = Date()
        let m = Calendar.current.component(.month, from: now)
        let d = Calendar.current.component(.day, from: now)
        if m < bMonth || (m == bMonth && d < bDay) { age -= 1 }
        if age < 18 {
            underageBail()
            return
        }

        let birthday = String(format: "%04d-%02d-%02d", bYear, bMonth, bDay)
        loading = true
        Task {
            do {
                try await auth.updateProfile(["birthday": .string(birthday)])
                step = .membership
            } catch {
                // Server-side 18+ trigger rejected it
                underageBail()
            }
            loading = false
        }
    }

    private func underageBail() {
        errorMessage = locale.t("signup.underage")
        Task { await auth.signOut() }
        step = .details
    }

    // ── Step 3 of 3: membership ───────────────────────────────────────────────

    private var membershipStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker("N° 04 · Membership")

            (Text(locale.t("signup.chooseMembership")) + Text("\n") + Text(locale.t("signup.membership")).italic())
                .font(.cfSerif(44))
                .foregroundStyle(Theme.ink)

            Text(locale.t("signup.membershipSubtitle"))
                .font(.cfSans(13.5))
                .foregroundStyle(Theme.stone)
                .padding(.bottom, 8)

            // Libero — the only selectable tier (paid tiers are "coming soon")
            tierCard(
                name: "Libero", sub: "Free", price: "€0",
                gradient: [Color(hex: 0xF8EFDC), Color(hex: 0xEFE0C3), Color(hex: 0xE5D2A8)],
                textColor: Theme.darkRed, subColor: Color(hex: 0x2A1F12),
                selected: true
            )

            // Paid tiers — blurred behind "Coming soon", exactly like web
            ZStack {
                VStack(spacing: 10) {
                    tierCard(
                        name: "Oro", sub: "Gold", price: "€19",
                        gradient: [Color(hex: 0x4A2C0E), Color(hex: 0x8C5A1E), Color(hex: 0xC28B3D)],
                        textColor: Color(hex: 0xFFE8B5), subColor: Color(hex: 0xFFF1D2),
                        selected: false
                    )
                    tierCard(
                        name: "Zaffiro", sub: "Sapphire", price: "€39",
                        gradient: [Color(hex: 0x0E1B4A), Color(hex: 0x1F3590), Color(hex: 0x4A6BC4)],
                        textColor: Color(hex: 0xDDE6FF), subColor: Color(hex: 0xEAEEFB),
                        selected: false
                    )
                    tierCard(
                        name: "Nero", sub: "Black", price: "€99",
                        gradient: [Color(hex: 0x050505), Color(hex: 0x1A1614), Color(hex: 0x2A1F12)],
                        textColor: Theme.flame, subColor: Theme.flame.opacity(0.8),
                        selected: false
                    )
                }
                .blur(radius: 4)
                .opacity(0.55)
                .allowsHitTesting(false)

                Text(locale.t("signup.comingSoon").uppercased())
                    .font(.cfMono(10, weight: .bold))
                    .kerning(2)
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Theme.cream.opacity(0.95), in: .capsule)
                    .overlay(Capsule().stroke(Theme.hairline))
            }

            PrimaryButton(title: locale.t("signup.startForFree"), loading: loading) {
                auth.finishOnboarding()
            }
            .padding(.top, 8)
        }
    }

    private func tierCard(name: String, sub: String, price: String, gradient: [Color], textColor: Color, subColor: Color, selected: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.cfSerif(20, italic: true))
                    .foregroundStyle(textColor)
                Text(sub.uppercased())
                    .font(.cfMono(9.5))
                    .kerning(1.9)
                    .foregroundStyle(subColor)
            }
            Spacer()
            Text(price)
                .font(.cfSerif(19))
                .foregroundStyle(textColor)
            Circle()
                .stroke(subColor.opacity(0.6), lineWidth: 1.5)
                .background(Circle().fill(selected ? textColor : .clear).padding(3))
                .frame(width: 18, height: 18)
        }
        .padding(16)
        .background(
            LinearGradient(colors: gradient, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: .rect(cornerRadius: 16)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(selected ? Color(hex: 0x2A1F12).opacity(0.35) : .white.opacity(0.2))
        )
    }
}
