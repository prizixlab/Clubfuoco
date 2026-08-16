import SwiftUI
import Supabase
import CoreLocation
import UIKit

/// Native settings — mirrors the web settings page minus the heavier surfaces
/// (full nightlife preferences picker, email verify, in-app subscription
/// cancel). Adds two iOS-only sections: editable Gender (required, saves
/// inline with name/phone) and Arrival check-in (status + deep link to the
/// system Location settings since iOS won't let us flip Always from in-app).
struct SettingsView: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(ThemeStore.self) private var theme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var fullName = ""
    @State private var phone = ""
    @State private var gender: Gender?
    @State private var birthday = Calendar.current.date(byAdding: .year, value: -25, to: Date()) ?? Date()
    @State private var loadedFromProfile = false
    @State private var saving = false
    @State private var savedFlash = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var errorMessage: String?
    @State private var locationStatus: CLAuthorizationStatus = .notDetermined
    @State private var showLocationSheet = false

    private var appVersion: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        return "\(v) (\(b))"
    }

    var body: some View {
        @Bindable var localeStore = locale
        @Bindable var themeStore = theme

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
                DatePicker(locale.t("settings.birthday"),
                           selection: $birthday,
                           in: minBirthday...maxBirthday,
                           displayedComponents: .date)

                Picker(locale.t("settings.gender"), selection: $gender) {
                    Text("—").tag(Gender?.none)
                    ForEach(Gender.allCases) { g in
                        Text(locale.t("signup.gender.\(g.rawValue)")).tag(Optional(g))
                    }
                }

                Button {
                    save()
                } label: {
                    HStack {
                        Text(locale.t(savedFlash ? "settings.saved" : "settings.save"))
                            .font(.cfSans(14, weight: .semibold))
                        if saving { ProgressView().padding(.leading, 4) }
                    }
                    .foregroundStyle(savedFlash ? Theme.success : Theme.wine)
                }
                .disabled(saving || !hasChanges)
            }

            Section(locale.t("settings.account")) {
                LabeledContent(locale.t("settings.email"), value: auth.profile?.email ?? auth.user?.email ?? "—")
            }

            Section {
                LabeledContent(locale.t("settings.arrivalStatus")) {
                    Text(locationStatusLabel)
                        .font(.cfSans(13, weight: .medium))
                        .foregroundStyle(locationStatusColor)
                }
                Button {
                    Haptics.tap()
                    // .notDetermined → no Location row exists in iOS Settings
                    // yet (iOS only creates it after the first OS prompt). Fire
                    // the in-app sheet to trigger that prompt. Same applies if
                    // they granted WhenInUse and we still need to upgrade to
                    // Always — the sheet's primary action runs that ask too.
                    if locationStatus == .notDetermined || locationStatus == .authorizedWhenInUse {
                        showLocationSheet = true
                    } else if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text(locale.t(
                        locationStatus == .notDetermined ? "location.enable" :
                        locationStatus == .authorizedWhenInUse ? "settings.upgradeToAlways" :
                        "settings.openIOSSettings"
                    ))
                    .foregroundStyle(Theme.wine)
                }
            } header: {
                Text(locale.t("settings.arrivalCheckIn"))
            } footer: {
                Text(locale.t("settings.arrivalFooter"))
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.fadedSand)
            }

            Section {
                Button {
                    Haptics.tap()
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text(locale.t("settings.openIOSSettings"))
                        .foregroundStyle(Theme.wine)
                }
            } header: {
                Text(locale.t("settings.notifications"))
            } footer: {
                Text(locale.t("settings.notificationsFooter"))
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.fadedSand)
            }

            Section(locale.t("settings.language")) {
                Picker(locale.t("settings.language"), selection: $localeStore.setting) {
                    Text(locale.t("settings.lang.device")).tag(LocaleStore.Setting.device)
                    Text(locale.t("settings.lang.en")).tag(LocaleStore.Setting.en)
                    Text(locale.t("settings.lang.es")).tag(LocaleStore.Setting.es)
                    Text(locale.t("settings.lang.ca")).tag(LocaleStore.Setting.ca)
                    Text(locale.t("settings.lang.fr")).tag(LocaleStore.Setting.fr)
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }

            Section(locale.t("settings.theme")) {
                Picker(locale.t("settings.theme"), selection: $themeStore.setting) {
                    Text(locale.t("settings.theme.system")).tag(ThemeStore.Setting.system)
                    Text(locale.t("settings.theme.light")).tag(ThemeStore.Setting.light)
                    Text(locale.t("settings.theme.dark")).tag(ThemeStore.Setting.dark)
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

            Section {
                HStack {
                    Spacer()
                    Text("Club Fuoco · v\(appVersion)")
                        .font(.cfMono(10))
                        .kerning(1.4)
                        .foregroundStyle(Theme.fadedSand)
                    Spacer()
                }
                .listRowBackground(Color.clear)
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
                gender = Gender(rawValue: auth.profile?.gender ?? "")
                if let d = Self.parseYMD(auth.profile?.birthday) { birthday = d }
                loadedFromProfile = true
            }
            locationStatus = LocationService.shared.authorizationStatus
        }
        .onChange(of: scenePhase) { _, new in
            // Returning from iOS Settings — refresh the displayed status.
            if new == .active { locationStatus = LocationService.shared.authorizationStatus }
        }
        .sheet(isPresented: $showLocationSheet, onDismiss: {
            locationStatus = LocationService.shared.authorizationStatus
        }) {
            LocationPermissionSheet(mode: .arrival)
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

    // ── Location status pill ─────────────────────────────────────────────────

    private var locationStatusLabel: String {
        switch locationStatus {
        case .authorizedAlways:    locale.t("settings.arrivalOn")
        case .authorizedWhenInUse: locale.t("settings.arrivalManualOnly")
        case .denied, .restricted: locale.t("settings.arrivalOff")
        default:                   locale.t("settings.arrivalNotSet")
        }
    }

    private var locationStatusColor: Color {
        switch locationStatus {
        case .authorizedAlways:    Theme.success
        case .authorizedWhenInUse: Theme.wine
        default:                   Theme.stone
        }
    }

    // ── Birthday (18+ enforced by the picker's range) ────────────────────────

    /// Youngest allowed: exactly 18 today. Oldest: 100 years back.
    private var maxBirthday: Date { Calendar.current.date(byAdding: .year, value: -18, to: Date()) ?? Date() }
    private var minBirthday: Date { Calendar.current.date(byAdding: .year, value: -100, to: Date()) ?? Date() }

    /// "YYYY-MM-DD" from a Date using calendar components (timezone-safe — a
    /// birthday is a plain date, not an instant).
    private static func formatYMD(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func parseYMD(_ value: String?) -> Date? {
        guard let value, value.count >= 10 else { return nil }
        let p = value.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        var c = DateComponents(); c.year = p[0]; c.month = p[1]; c.day = p[2]; c.hour = 12
        return Calendar.current.date(from: c)
    }

    // ── Save (name + phone + gender + birthday) ──────────────────────────────

    private var hasChanges: Bool {
        fullName != (auth.profile?.fullName ?? "")
            || phone != (auth.profile?.phone ?? "")
            || (gender?.rawValue ?? "") != (auth.profile?.gender ?? "")
            || Self.formatYMD(birthday) != (auth.profile?.birthday.map { String($0.prefix(10)) } ?? "")
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
                if let gender { updates["gender"] = .string(gender.rawValue) }
                updates["birthday"] = .string(Self.formatYMD(birthday))
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
