import SwiftUI
import Supabase

/// Native port of (auth)/complete-profile — shown after an OAuth sign-in that
/// didn't give us everything (Apple hides email relays, never gives phone).
/// Renders only the missing fields, updates the users row, then finishes
/// onboarding.
struct CompleteProfileView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale

    private struct Missing {
        var name = false, email = false, phone = false, birthday = false, gender = false
        var any: Bool { name || email || phone || birthday || gender }
    }

    @State private var ready = false
    @State private var missing = Missing()

    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var gender: Gender?

    private static let currentYear = Calendar.current.component(.year, from: Date())
    private static let monthsIT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
                                   "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
    @State private var bDay = 17
    @State private var bMonth = 5
    @State private var bYear = currentYear - 25

    @State private var saving = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if ready {
                form
            } else {
                Theme.cream.ignoresSafeArea()
            }
        }
        .background(Theme.cream)
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .task { await load() }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Kicker("N° 01 · Quasi fatto")
                    .padding(.top, 28)

                (Text(locale.t("completeProfile.title")).italic()
                    + Text(" \(locale.t("completeProfile.titleEm"))"))
                    .font(.cfSerif(44))
                    .foregroundStyle(Theme.ink)

                Text(locale.t("completeProfile.subtitle"))
                    .font(.cfSans(14))
                    .foregroundStyle(Theme.stone)
                    .padding(.bottom, 12)

                if missing.name {
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
                }

                if missing.email {
                    AuthField(label: locale.t("auth.email")) {
                        TextField("you@fuoco.club", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.cfSans(16))
                    }
                }

                if missing.phone {
                    AuthField(label: locale.t("settings.phone")) {
                        PhoneNumberField(phone: $phone)
                    }
                }

                if missing.gender {
                    VStack(alignment: .leading, spacing: 8) {
                        Kicker(locale.t("signup.genderLabel"), color: Theme.fadedSand, size: 9)
                        GenderPicker(selection: $gender, locale: locale)
                    }
                }

                if missing.birthday {
                    VStack(alignment: .leading, spacing: 8) {
                        Kicker(locale.t("completeProfile.birthdayLabel"), color: Theme.fadedSand, size: 9)
                        HStack(spacing: 0) {
                            wheel(locale.t("signup.day"), selection: $bDay, values: Array(1...31)) { String($0) }
                            wheel(locale.t("signup.month"), selection: $bMonth, values: Array(1...12)) { monthNames[$0 - 1] }
                            wheel(locale.t("signup.year"), selection: $bYear, values: Array((Self.currentYear - 100)...(Self.currentYear - 17)).reversed()) { String($0) }
                        }
                        .background(Color.white, in: .rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))

                        Text("\(bDay) \(Self.monthsIT[bMonth - 1]) \(bYear)")
                            .font(.cfSerif(16, italic: true))
                            .foregroundStyle(Theme.wine)
                            .frame(maxWidth: .infinity)
                    }
                }

                if let errorMessage {
                    FormError(message: errorMessage)
                }

                PrimaryButton(
                    title: locale.t(saving ? "completeProfile.saving" : "completeProfile.enter"),
                    loading: saving
                ) {
                    save()
                }
                .padding(.top, 8)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var monthNames: [String] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale)
        return formatter.monthSymbols
    }

    private func wheel<V: Hashable>(_ label: String, selection: Binding<V>, values: [V], format: @escaping (V) -> String) -> some View {
        VStack(spacing: 4) {
            Kicker(label, color: Theme.fadedSand, size: 9)
            Picker(label, selection: selection) {
                ForEach(values, id: \.self) { v in
                    Text(format(v)).font(.cfSerif(20)).tag(v)
                }
            }
            .pickerStyle(.wheel)
            .frame(height: 140)
            .clipped()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func load() async {
        await auth.refreshProfile()
        let row = auth.profile
        var m = Missing()
        m.name = (row?.fullName ?? "").isEmpty
        m.email = (row?.email ?? "").isEmpty
        m.phone = (row?.phone ?? "").isEmpty
        m.birthday = (row?.birthday ?? "").isEmpty
        m.gender = (row?.gender ?? "").isEmpty

        if !m.any {
            auth.finishOnboarding()
            return
        }
        if let full = row?.fullName, !full.isEmpty {
            let parts = full.split(separator: " ")
            firstName = String(parts.first ?? "")
            lastName = parts.dropFirst().joined(separator: " ")
        }
        if let e = row?.email { email = e }
        missing = m
        ready = true
    }

    private func save() {
        errorMessage = nil
        var updates: [String: AnyJSON] = [:]

        if missing.name {
            let full = "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
            guard !full.isEmpty else { errorMessage = locale.t("completeProfile.nameError"); return }
            updates["full_name"] = .string(full)
        }
        if missing.email {
            let trimmed = email.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { errorMessage = locale.t("completeProfile.emailError"); return }
            updates["email"] = .string(trimmed)
        }
        if missing.phone {
            let trimmed = phone.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { errorMessage = locale.t("completeProfile.phoneError"); return }
            updates["phone"] = .string(trimmed)
        }
        if missing.gender {
            guard let gender else { errorMessage = locale.t("signup.genderError"); return }
            updates["gender"] = .string(gender.rawValue)
        }
        if missing.birthday {
            var age = Self.currentYear - bYear
            let now = Date()
            let m = Calendar.current.component(.month, from: now)
            let d = Calendar.current.component(.day, from: now)
            if m < bMonth || (m == bMonth && d < bDay) { age -= 1 }
            guard age >= 18 else { errorMessage = locale.t("signup.underage"); return }
            updates["birthday"] = .string(String(format: "%04d-%02d-%02d", bYear, bMonth, bDay))
        }

        saving = true
        Task {
            do {
                try await auth.updateProfile(updates)
                Haptics.success()
                auth.finishOnboarding()
            } catch {
                Haptics.error()
                let msg = error.localizedDescription
                errorMessage = msg.contains("18") ? locale.t("signup.underage") : msg
            }
            saving = false
        }
    }
}
