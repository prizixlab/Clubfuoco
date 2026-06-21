import SwiftUI

/// Native screen the Fuoco app shows when a Universal Link to
/// /i/<token> opens it. Mirrors the web claim page but auto-fills the
/// recipient's name from their Fuoco profile.
struct InviteClaimView: View {
    let token: String
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @Environment(\.api) private var api
    @State private var loading = true
    @State private var error: String?
    @State private var detail: InviteDetail?
    @State private var name: String = ""
    @State private var plusOnes: Int = 0
    @State private var submitting = false
    @State private var claimedGuestId: String?

    private static let baseURL = "https://clubfuoco.com"

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            content
        }
        .preferredColorScheme(.dark)
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView().tint(Theme.parchment)
        } else if let error {
            VStack(spacing: 12) {
                Text(error).font(.cfSans(15)).foregroundStyle(Theme.parchment)
                Button("Close") { dismiss() }
                    .foregroundStyle(Theme.ember)
            }
            .padding(40)
        } else if let claimedGuestId, let detail {
            ticket(guestId: claimedGuestId, detail: detail)
        } else if let detail {
            form(detail: detail)
        }
    }

    // ── Loading ──────────────────────────────────────────────────────────────

    private func load() async {
        loading = true
        defer { loading = false }
        struct Resp: Decodable, Sendable {
            let allocation: InviteDetail
            let guests: [InviteGuest]
        }
        do {
            let resp: Resp = try await api.get("/api/promoter-invites/\(token)")
            self.detail = resp.allocation
            if let full = auth.profile?.fullName, !full.isEmpty {
                name = full
            }
        } catch {
            self.error = "Couldn't load this invite — the link may be expired."
        }
    }

    // ── Form ─────────────────────────────────────────────────────────────────

    private func form(detail: InviteDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(detail: detail)

                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("RESERVE YOUR SPOT")
                            .font(.cfMono(10)).kerning(2)
                            .foregroundStyle(Theme.flame)
                        Spacer()
                    }

                    TextField("", text: $name,
                              prompt: Text("Full name").foregroundStyle(Theme.parchment.opacity(0.5)))
                        .font(.cfSans(16))
                        .foregroundStyle(Theme.parchment)
                        .textInputAutocapitalization(.words)
                        .padding(.vertical, 10)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Theme.parchment.opacity(0.2)).frame(height: 1)
                        }

                    HStack {
                        Text("Plus ones").font(.cfSans(13)).foregroundStyle(Theme.parchment.opacity(0.6))
                        Spacer()
                        Button { if plusOnes > 0 { plusOnes -= 1 } } label: {
                            Image(systemName: "minus").foregroundStyle(Theme.parchment)
                                .frame(width: 32, height: 32)
                                .background(Circle().stroke(Theme.parchment.opacity(0.2)))
                        }
                        Text("\(plusOnes)").font(.cfSerif(22)).foregroundStyle(Theme.parchment).frame(minWidth: 30)
                        Button { if plusOnes < 4 { plusOnes += 1 } } label: {
                            Image(systemName: "plus").foregroundStyle(Color(hex: 0xFFF6E5))
                                .frame(width: 32, height: 32)
                                .background(Circle().fill(Theme.ember))
                        }
                    }
                    .padding(.top, 6)
                }
                .padding(18)
                .background(RoundedRectangle(cornerRadius: 18).fill(Color(hex: 0x15110E)))

                Button(action: submit) {
                    Text(submitting ? "Joining…" : "Add me to the list")
                        .font(.cfSans(15, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xFFF6E5))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(Theme.ember))
                }
                .disabled(submitting || name.trimmingCharacters(in: .whitespaces).isEmpty)

                if detail.groupVisible {
                    Text("EVERYONE WILL SEE YOU ON THE GUESTLIST")
                        .font(.cfMono(9)).kerning(1.5)
                        .foregroundStyle(Theme.parchment.opacity(0.5))
                        .frame(maxWidth: .infinity)
                }

                Button("Not now") { dismiss() }
                    .foregroundStyle(Theme.parchment.opacity(0.5))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
            }
            .padding(24)
        }
    }

    private func header(detail: InviteDetail) -> some View {
        let night = detail.night
        return VStack(alignment: .leading, spacing: 6) {
            Text("YOU'RE INVITED")
                .font(.cfMono(11)).kerning(2)
                .foregroundStyle(Theme.flame)
            Text(night.title ?? night.club.name)
                .font(.cfSerif(40))
                .foregroundStyle(Theme.parchment)
            Text("\(night.club.name) · \(Self.formatDate(night.nightDate))")
                .font(.cfSans(13))
                .foregroundStyle(Theme.parchment.opacity(0.7))
        }
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        submitting = true
        Task {
            defer { submitting = false }
            struct Body: Encodable, Sendable {
                let fullName: String
                let plusOnes: Int
                let claimedByUser: UUID?
                enum CodingKeys: String, CodingKey {
                    case fullName = "full_name"
                    case plusOnes = "plus_ones"
                    case claimedByUser = "claimed_by_user"
                }
            }
            struct ClaimedGuest: Decodable, Sendable { let id: String }
            struct Resp: Decodable, Sendable { let guest: ClaimedGuest }
            let uid: UUID? = auth.user?.id
            do {
                let resp: Resp = try await api.post(
                    "/api/promoter-invites/\(token)/claim",
                    body: Body(fullName: trimmed, plusOnes: plusOnes, claimedByUser: uid))
                claimedGuestId = resp.guest.id
                Haptics.success()
                InviteClaimsStore.shared.add(token: token, guestId: resp.guest.id)
                Task { await LocationService.shared.syncGeofences() }
            } catch {
                self.error = "Couldn't add you to the list."
                Haptics.error()
            }
        }
    }

    // ── Ticket ───────────────────────────────────────────────────────────────

    private func ticket(guestId: String, detail: InviteDetail) -> some View {
        let night = detail.night
        return ScrollView {
            VStack(spacing: 18) {
                Text("YOU'RE ON THE LIST")
                    .font(.cfMono(11)).kerning(2)
                    .foregroundStyle(Theme.flame)
                Text(name)
                    .font(.cfSerif(34))
                    .foregroundStyle(Theme.parchment)
                Text("\(night.title ?? night.club.name) · \(Self.formatDate(night.nightDate))")
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.parchment.opacity(0.7))

                Image(uiImage: generateQR("fuoco-invite:\(guestId)"))
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 220, height: 220)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0xFFF6E5)))

                Text("SHOW THIS AT THE DOOR")
                    .font(.cfMono(10)).kerning(1.5)
                    .foregroundStyle(Theme.parchment.opacity(0.5))

                Link(destination: URL(string: "\(Self.baseURL)/api/promoter-invites/guest/\(guestId)/wallet")!) {
                    HStack(spacing: 8) {
                        Image(systemName: "wallet.pass.fill")
                        Text("Add to Apple Wallet").font(.cfSans(14, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(Capsule().fill(Color.black))
                }
                .padding(.top, 4)

                Button("Done") { dismiss() }
                    .foregroundStyle(Theme.parchment.opacity(0.6))
                    .padding(.top, 18)
            }
            .padding(32)
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static func formatDate(_ ymd: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        let out = DateFormatter(); out.dateFormat = "EEE d MMM"
        return out.string(from: d)
    }

    private func generateQR(_ string: String) -> UIImage {
        let data = string.data(using: .utf8)
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return UIImage() }
        f.setValue(data, forKey: "inputMessage")
        f.setValue("H", forKey: "inputCorrectionLevel")
        guard let ci = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(ci, from: ci.extent)
        else { return UIImage() }
        return UIImage(cgImage: cg)
    }
}

// MARK: - Models

struct InviteDetail: Decodable, Sendable {
    let id: UUID
    let spots: Int
    let groupVisible: Bool
    let night: InviteNight
    enum CodingKeys: String, CodingKey {
        case id, spots
        case groupVisible = "group_visible"
        case night
    }
}
struct InviteNight: Decodable, Sendable {
    let id: UUID
    let title: String?
    let nightDate: String
    let openTime: String?
    let closeTime: String?
    let club: InviteClub
    enum CodingKeys: String, CodingKey {
        case id, title
        case nightDate = "night_date"
        case openTime = "open_time"
        case closeTime = "close_time"
        case club
    }
}
struct InviteClub: Decodable, Sendable {
    let id: UUID
    let name: String
    let address: String?
    let lat: Double?
    let lng: Double?
}
struct InviteGuest: Decodable, Sendable {
    let id: UUID
    let fullName: String
    let plusOnes: Int
    enum CodingKeys: String, CodingKey {
        case id
        case fullName = "full_name"
        case plusOnes = "plus_ones"
    }
}

// MARK: - Local store of claimed invites (for geofence + revisit)

@MainActor
final class InviteClaimsStore {
    static let shared = InviteClaimsStore()
    private let key = "cf.invite_claims.v1"

    struct Claim: Codable, Identifiable, Hashable {
        let token: String
        let guestId: String
        let claimedAt: Date
        var id: String { guestId }
    }

    func all() -> [Claim] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let v = try? JSONDecoder().decode([Claim].self, from: data)
        else { return [] }
        return v
    }

    func add(token: String, guestId: String) {
        var v = all().filter { $0.guestId != guestId }
        v.append(.init(token: token, guestId: guestId, claimedAt: Date()))
        if let data = try? JSONEncoder().encode(v) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    func remove(guestId: String) {
        let v = all().filter { $0.guestId != guestId }
        if let data = try? JSONEncoder().encode(v) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}
