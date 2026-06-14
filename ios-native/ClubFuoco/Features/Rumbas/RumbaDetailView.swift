import SwiftUI
import Observation

/// Native port of the rumba detail: cover, date, dress code, capacity bar,
/// guest-list signup form (name + plus-ones), and my signup status.
struct RumbaDetailView: View {
    let rumba: Rumba
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var model = RumbaDetailViewModel()
    @State private var showGuestGate = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Hero
                ZStack(alignment: .bottomLeading) {
                    Color(hex: 0xEFE9DD)
                        .overlay {
                            if let url = rumba.coverImage.flatMap(URL.init(string:)) {
                                CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0xEFE9DD) }
                            }
                        }
                        .frame(height: 240)
                        .clipped()
                    LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .bottom, endPoint: .top)
                    VStack(alignment: .leading, spacing: 4) {
                        Kicker("RUMBA", color: Theme.flame, size: 9)
                        Text(rumba.title)
                            .font(.cfSerif(30))
                            .foregroundStyle(.white)
                        Text([rumba.venueName, formatDate(rumba.eventDate)].compactMap { $0 }.joined(separator: " · "))
                            .font(.cfSans(13))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(16)
                }
                .clipShape(.rect(cornerRadius: Theme.radiusCard))

                if let description = rumba.description {
                    Text(description)
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.stone)
                }

                if let dressCode = rumba.dressCode {
                    Label(String(format: locale.t("rumba.dressCode"), dressCode), systemImage: "tshirt")
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.ink)
                }

                // Capacity
                if let capacity = rumba.capacity, capacity > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("\(rumba.signupCount ?? 0) / \(capacity)")
                                .font(.cfSans(12, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Text(String(format: locale.t("rumba.spotsLeft"), rumba.spotsLeft))
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.fadedSand)
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.hairline)
                                Capsule()
                                    .fill(Theme.ember)
                                    .frame(width: geo.size.width * min(1, Double(rumba.signupCount ?? 0) / Double(capacity)))
                            }
                        }
                        .frame(height: 6)
                    }
                    .padding(14)
                    .background(Color.white, in: .rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                }

                if let error = model.errorMessage {
                    FormError(message: error)
                }

                // Signup
                if let signup = model.mySignup {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundStyle(Color(hex: 0x2D7A46))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(locale.t("rumba.onList"))
                                .font(.cfSans(14, weight: .medium))
                                .foregroundStyle(Theme.ink)
                            Text(signup.status == "waitlist"
                                 ? locale.t("rumba.waitlist")
                                 : locale.t("bookings.statusConfirmed"))
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.fadedSand)
                        }
                        Spacer()
                    }
                    .padding(14)
                    .background(Color.white, in: .rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x2D7A46).opacity(0.3)))
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        AuthField(label: locale.t("rumba.yourName")) {
                            TextField("", text: $model.name)
                                .textContentType(.name)
                                .font(.cfSans(16))
                        }
                        HStack {
                            Kicker(locale.t("rumba.plusOnes"), color: Theme.fadedSand, size: 9)
                            Spacer()
                            Picker(locale.t("rumba.plusOnes"), selection: $model.plusOnes) {
                                ForEach(0...3, id: \.self) { Text("+\($0)").tag($0) }
                            }
                            .pickerStyle(.segmented)
                            .frame(width: 180)
                        }
                        PrimaryButton(
                            title: locale.t("rumba.joinList"),
                            loading: model.joining,
                            disabled: model.name.trimmingCharacters(in: .whitespaces).isEmpty,
                            background: Theme.ember
                        ) {
                            if auth.user == nil {
                                showGuestGate = true
                            } else {
                                model.signUp(rumbaId: rumba.id, api: api)
                            }
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(20)
        }
        .background(Theme.cream)
        .scrollDismissesKeyboard(.interactively)
        .task {
            model.name = auth.profile?.fullName ?? ""
            await model.loadMySignup(rumbaId: rumba.id, api: api)
        }
        .sheet(isPresented: $showGuestGate) {
            GuestGateView().presentationDetents([.medium])
        }
    }

    private func formatDate(_ value: String?) -> String? {
        guard let value else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let date = iso.date(from: value) ?? {
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return iso.date(from: value)
        }() ?? {
            // "2026-05-29T00:00:00+00:00" variants
            let df = DateFormatter()
            df.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZZZZZ"
            return df.date(from: value)
        }()
        guard let date else { return String(value.prefix(10)) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        formatter.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return formatter.string(from: date)
    }
}

@MainActor
@Observable
final class RumbaDetailViewModel {
    private(set) var mySignup: RumbaSignup?
    private(set) var joining = false
    var errorMessage: String?
    var name = ""
    var plusOnes = 0

    func loadMySignup(rumbaId: UUID, api: APIClient) async {
        mySignup = try? await api.get("/api/rumbas/\(rumbaId.uuidString.lowercased())/signups/mine")
    }

    func signUp(rumbaId: UUID, api: APIClient) {
        joining = true
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable { let name: String; let plusOnes: Int }
                let result: RumbaSignup = try await api.post(
                    "/api/rumbas/\(rumbaId.uuidString.lowercased())/signups",
                    body: Body(name: name.trimmingCharacters(in: .whitespaces), plusOnes: plusOnes)
                )
                mySignup = result
                Haptics.success()
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            joining = false
        }
    }
}
