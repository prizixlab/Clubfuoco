import SwiftUI
import Supabase

/// Native port of the settings page — Phase 1 scope: Personal (name, phone,
/// birthday), Account (email, read-only), Language, and Account Actions
/// (sign out, delete account via POST /api/account/delete). Nightlife
/// preferences and notification toggles land in Phase 2 with the
/// preferences/survey surfaces.
struct SettingsView: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss

    @State private var fullName = ""
    @State private var phone = ""
    @State private var loadedFromProfile = false
    @State private var saving = false
    @State private var savedFlash = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var errorMessage: String?

    var body: some View {
        @Bindable var localeStore = locale

        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(locale.t("settings.yourAccount"))
                        .font(.cfSerif(34))
                        .foregroundStyle(Theme.ink)
                    Text(locale.t("settings.subtitle"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.stone)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(.init(top: 8, leading: 4, bottom: 8, trailing: 4))
            }

            Section(locale.t("settings.personal")) {
                LabeledContent {
                    TextField(locale.t("settings.fullName"), text: $fullName)
                        .multilineTextAlignment(.trailing)
                        .textContentType(.name)
                } label: {
                    Text(locale.t("settings.fullName"))
                }
                LabeledContent {
                    PhoneNumberField(phone: $phone, trailing: true)
                } label: {
                    Text(locale.t("settings.phone"))
                }
                LabeledContent(locale.t("settings.birthday"), value: auth.profile?.birthday ?? "—")

                Button {
                    save()
                } label: {
                    HStack {
                        Text(locale.t(savedFlash ? "settings.saved" : "settings.save"))
                            .font(.cfSans(14, weight: .semibold))
                        if saving { ProgressView().padding(.leading, 4) }
                    }
                    .foregroundStyle(savedFlash ? Color(hex: 0x2D7A46) : Theme.wine)
                }
                .disabled(saving || !hasChanges)
            }

            Section(locale.t("settings.account")) {
                LabeledContent(locale.t("settings.email"), value: auth.profile?.email ?? auth.user?.email ?? "—")
            }

            Section(locale.t("settings.language")) {
                Picker(locale.t("settings.language"), selection: $localeStore.setting) {
                    Text(locale.t("settings.lang.device")).tag(LocaleStore.Setting.device)
                    Text(locale.t("settings.lang.en")).tag(LocaleStore.Setting.en)
                    Text(locale.t("settings.lang.es")).tag(LocaleStore.Setting.es)
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }

            Section(locale.t("settings.accountActions")) {
                Button {
                    Haptics.tap()
                    Task { await auth.signOut() }
                } label: {
                    Text(locale.t("settings.signOut"))
                        .foregroundStyle(Theme.ink)
                }

                Button(role: .destructive) {
                    confirmDelete = true
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(locale.t(deleting ? "settings.deleting" : "settings.deleteAccount"))
                        Text(locale.t("settings.permanent"))
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.fadedSand)
                    }
                }
                .disabled(deleting)
            }

            if let errorMessage {
                Section {
                    FormError(message: errorMessage)
                        .listRowBackground(Color.clear)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.cream)
        .navigationTitle(locale.t("profile.settingsRow"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !loadedFromProfile {
                await auth.refreshProfile()
                fullName = auth.profile?.fullName ?? ""
                phone = auth.profile?.phone ?? ""
                loadedFromProfile = true
            }
        }
        .alert(locale.t("settings.deleteQuestion"), isPresented: $confirmDelete) {
            Button(locale.t("settings.keepAccount"), role: .cancel) {}
            Button(locale.t("settings.yesDelete"), role: .destructive) {
                deleteAccount()
            }
        } message: {
            Text(locale.t("settings.deleteWarning"))
        }
    }

    private var hasChanges: Bool {
        fullName != (auth.profile?.fullName ?? "") || phone != (auth.profile?.phone ?? "")
    }

    private func save() {
        saving = true
        errorMessage = nil
        Task {
            do {
                var updates: [String: AnyJSON] = [:]
                let name = fullName.trimmingCharacters(in: .whitespaces)
                let phoneTrimmed = phone.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { updates["full_name"] = .string(name) }
                if !phoneTrimmed.isEmpty { updates["phone"] = .string(phoneTrimmed) }
                try await auth.updateProfile(updates)
                Haptics.success()
                savedFlash = true
                try? await Task.sleep(for: .seconds(2))
                savedFlash = false
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private func deleteAccount() {
        deleting = true
        errorMessage = nil
        Task {
            do {
                struct DeleteResult: Decodable, Sendable { let deleted: Bool? }
                let _: DeleteResult = try await api.post("/api/account/delete")
                await auth.signOut()
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
                deleting = false
            }
        }
    }
}
