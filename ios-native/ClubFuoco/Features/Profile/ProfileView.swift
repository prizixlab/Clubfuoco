import SwiftUI
import Observation

/// Native port of the profile page: CLUB FUOCO · ACCOUNT header, membership
/// card with tier styling, stats strip, menu sections, sign out, footer.
/// Friends / Saved / Membership destinations are Phase 2 — their rows show
/// the same "coming soon" treatment the web uses for unreleased surfaces.
struct ProfileView: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var model = ProfileViewModel()
    #if DEBUG
    // CF_TEST_PUSH=settings|friends|membership|notifications|fiamme
    // (CF_TEST_SETTINGS=1 kept as an alias)
    @State private var debugPush: String? = {
        let env = ProcessInfo.processInfo.environment
        if env["CF_TEST_SETTINGS"] == "1" { return "settings" }
        return env["CF_TEST_PUSH"]
    }()
    #endif

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack(spacing: 8) {
                    Kicker(locale.t("profile.header"), color: Theme.fadedSand)
                    Spacer()
                    NavigationLink {
                        NotificationsView()
                    } label: {
                        Image(systemName: "bell")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.stone)
                            .frame(width: 36, height: 36)
                            .background(Color.white, in: .circle)
                    }
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.stone)
                            .frame(width: 36, height: 36)
                            .background(Color.white, in: .circle)
                    }
                }
                .padding(.init(top: 8, leading: 20, bottom: 12, trailing: 20))

                membershipCard
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)

                statsStrip
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)

                menuSections
                    .padding(.horizontal, 20)
            }
        }
        .background(Theme.cream)
        .toolbar(.hidden, for: .navigationBar)
        #if DEBUG
        .navigationDestination(isPresented: Binding(
            get: { debugPush != nil },
            set: { if !$0 { debugPush = nil } }
        )) {
            switch debugPush {
            case "friends": FriendsView()
            case "membership": MembershipView()
            case "notifications": NotificationsView()
            case "fiamme": FiammeView()
            default: SettingsView()
            }
        }
        #endif
        .task {
            await auth.refreshProfile()
            await model.load(api: api, queries: auth.queries)
        }
    }

    // ── Membership card ───────────────────────────────────────────────────────

    private var tier: TierStyle {
        TierStyle.for(auth.profile?.membershipTier ?? "free")
    }

    private var nameParts: (first: String, last: String, initials: String) {
        let parts = (auth.profile?.fullName ?? "").split(separator: " ").map(String.init)
        let first = parts.first ?? ""
        let last = parts.dropFirst().joined(separator: " ")
        let initials = parts.prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
        return (first, last, initials.isEmpty ? "?" : initials)
    }

    private var memberNumber: String {
        guard let id = auth.user?.id.uuidString, !id.isEmpty else { return "001" }
        let first = Int(id.unicodeScalars.first!.value)
        let last = Int(id.unicodeScalars.last!.value)
        return String(format: "%03d", (first * 7 + last * 3) % 999 + 1)
    }

    private var memberYear: String {
        guard let created = auth.profile?.createdAt, created.count >= 4 else { return "—" }
        return String(created.prefix(4))
    }

    private var membershipCard: some View {
        let parts = nameParts
        return ZStack {
            LinearGradient(colors: tier.gradient, startPoint: .topLeading, endPoint: .bottomTrailing)

            // Corner labels
            VStack {
                HStack {
                    Kicker("N° \(memberNumber.prefix(2))", color: tier.faded, size: 8.5)
                    Spacer()
                    Kicker("BARCELONA", color: tier.faded, size: 8.5)
                }
                Spacer()
                HStack {
                    Kicker("EST. \(memberYear)", color: tier.faded, size: 8.5)
                    Spacer()
                    Kicker("N° \(memberNumber)", color: tier.faded, size: 8.5)
                }
            }
            .padding(14)

            VStack(alignment: .leading, spacing: 10) {
                // Avatar / initials
                Circle()
                    .fill(tier.avatarBg)
                    .frame(width: 84, height: 84)
                    .overlay {
                        Text(parts.initials)
                            .font(.cfSerif(42, italic: true))
                            .foregroundStyle(tier.accent)
                    }

                Kicker("\(locale.t("profile.socio")) · \(locale.t("profile.member"))", color: tier.soft, size: 9.5)

                VStack(alignment: .leading, spacing: 0) {
                    Text(parts.first.isEmpty ? locale.t("profile.member") : parts.first)
                        .font(.cfSerif(36))
                        .foregroundStyle(tier.nameColor)
                    if !parts.last.isEmpty {
                        Text(parts.last)
                            .font(.cfSerif(36, italic: true))
                            .foregroundStyle(tier.accent)
                    }
                }

                Text(auth.profile?.email ?? auth.user?.email ?? "")
                    .font(.cfSans(10))
                    .kerning(1.2)
                    .foregroundStyle(tier.soft)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Circle().fill(Theme.wine).frame(width: 6, height: 6)
                    Text(tier.label)
                        .font(.cfSerif(14, italic: true))
                        .foregroundStyle(tier.accent)
                    Text("/ \(locale.t("profile.member"))")
                        .font(.cfSans(9.5))
                        .kerning(1.7)
                        .foregroundStyle(tier.soft)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(tier.badgeBg, in: .capsule)

                // Wallet pass — paid tiers only, like the web card
                if (auth.profile?.membershipTier ?? "free") != "free", let userId = auth.user?.id {
                    WalletPassButton(passPath: "/api/membership/wallet/\(userId.uuidString.lowercased())", compact: true)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.init(top: 36, leading: 20, bottom: 40, trailing: 20))
        }
        .clipShape(.rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(tier.border))
    }

    // ── Stats strip ───────────────────────────────────────────────────────────

    private var statsStrip: some View {
        HStack(spacing: 0) {
            stat(value: model.nights, italian: "Notti", caption: locale.t("profile.statNights"))
            divider
            stat(value: model.savedCount, italian: "Salvati", caption: locale.t("profile.statSaved"))
            divider
            stat(value: model.friendCount, italian: "Amici", caption: locale.t("profile.statFriends"))
        }
    }

    private var divider: some View {
        Rectangle().fill(Theme.hairline).frame(width: 1, height: 48)
    }

    private func stat(value: Int?, italian: String, caption: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value.map(String.init) ?? "—")
                .font(.cfSerif(30))
                .foregroundStyle(Theme.wine)
            Text(italian)
                .font(.cfSerif(13, italic: true))
                .foregroundStyle(Theme.ink)
            Kicker(caption, color: Theme.fadedSand, size: 8.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
    }

    // ── Menu ──────────────────────────────────────────────────────────────────

    private var menuSections: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.bottom, 16)
            Kicker(locale.t("profile.accountSection"), color: Theme.fadedSand, size: 9)
                .padding(.bottom, 8)

            NavigationLink {
                BookingsView()
            } label: {
                menuRow(n: "01", icon: "ticket.fill",
                        label: locale.t("profile.myBookings"),
                        sub: model.nights.map { String(format: locale.t("profile.bookingsCount"), $0) } ?? "—")
            }
            menuRowDivider
            menuRow(n: "02", icon: "heart.fill",
                    label: locale.t("profile.savedClubs"),
                    sub: model.savedCount.map { String(format: locale.t("profile.savedCount"), $0) } ?? "—",
                    comingSoon: true)
            menuRowDivider
            NavigationLink {
                FriendsView()
            } label: {
                menuRow(n: "03", icon: "person.2.fill",
                        label: locale.t("profile.friends"),
                        sub: model.friendsSub ?? "—")
            }
            menuRowDivider
            NavigationLink {
                MembershipView()
            } label: {
                menuRow(n: "04", icon: "crown.fill",
                        label: locale.t("profile.membership"),
                        sub: "\(tier.label) · \(locale.t("profile.member"))")
            }

            Rectangle().fill(Color(hex: 0x221E1A).opacity(0.16)).frame(height: 1)
                .padding(.vertical, 12)
            Kicker(locale.t("profile.prefsSection"), color: Theme.fadedSand, size: 9)
                .padding(.bottom, 8)

            NavigationLink {
                SettingsView()
            } label: {
                menuRow(n: "04", icon: "slider.horizontal.3",
                        label: locale.t("profile.settingsRow"),
                        sub: locale.t("profile.settingsSub"))
            }
            menuRowDivider
            Link(destination: URL(string: "https://clubfuoco.vercel.app/legal/help")!) {
                menuRow(n: "05", icon: "questionmark.circle.fill",
                        label: locale.t("profile.help"),
                        sub: locale.t("profile.helpSub"))
            }
            menuRowDivider
            Link(destination: URL(string: "https://clubfuoco.vercel.app/legal/terms")!) {
                menuRow(n: "06", icon: "text.book.closed.fill",
                        label: locale.t("profile.legal"),
                        sub: locale.t("profile.legalSub"))
            }

            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.vertical, 8)

            Button {
                Haptics.tap()
                Task { await auth.signOut() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 13))
                    Text(locale.t("settings.signOut").uppercased())
                        .font(.cfSans(11, weight: .semibold))
                        .kerning(2.4)
                }
                .foregroundStyle(Theme.wine)
                .padding(.vertical, 16)
            }

            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.bottom, 12)
            HStack(spacing: 16) {
                Kicker(locale.t("profile.footerCompany"), color: Theme.fadedSand, size: 8)
                Kicker("v1.0 · MMXXVI", color: Theme.fadedSand, size: 8)
            }
            .padding(.bottom, 6)
            Text(locale.t("profile.footerQuote"))
                .font(.cfSerif(14, italic: true))
                .foregroundStyle(Theme.fadedSand)
                .padding(.bottom, 24)
        }
    }

    private var menuRowDivider: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }

    private func menuRow(n: String, icon: String, label: String, sub: String, comingSoon: Bool = false) -> some View {
        HStack(spacing: 12) {
            Kicker(n, color: Theme.fadedSand, size: 9)
                .frame(width: 18, alignment: .leading)
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(Theme.wine)
                .frame(width: 32, height: 32)
                .background(Theme.wine.opacity(0.08), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.cfSerif(19))
                    .foregroundStyle(Theme.ink)
                Text(sub)
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.fadedSand)
            }
            Spacer()
            if comingSoon {
                Text(locale.t("signup.comingSoon").uppercased())
                    .font(.cfMono(8))
                    .kerning(1.2)
                    .foregroundStyle(Theme.stone)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color(hex: 0x2A1F12).opacity(0.07), in: .capsule)
            } else {
                Image(systemName: "arrow.right")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.fadedSand)
            }
        }
        .padding(.vertical, 14)
        .opacity(comingSoon ? 0.6 : 1)
        .contentShape(.rect)
    }
}

// ── Tier styling (mirrors TIERS in profile/page.tsx + signup gradients) ───────

struct TierStyle {
    let label: String
    let gradient: [Color]
    let border: Color
    let accent: Color
    let soft: Color
    let faded: Color
    let nameColor: Color
    let avatarBg: Color
    let badgeBg: Color

    static func `for`(_ tier: String) -> TierStyle {
        switch tier {
        case "gold":
            return TierStyle(
                label: "Oro",
                gradient: [Color(hex: 0x4A2C0E), Color(hex: 0x8C5A1E), Color(hex: 0xC28B3D)],
                border: .white.opacity(0.25),
                accent: Color(hex: 0xFFE8B5), soft: Color(hex: 0xFFF1D2).opacity(0.8),
                faded: Color(hex: 0xFFE8B5).opacity(0.5),
                nameColor: Color(hex: 0xFFF6E5),
                avatarBg: .black.opacity(0.25), badgeBg: .white.opacity(0.14)
            )
        case "sapphire":
            return TierStyle(
                label: "Zaffiro",
                gradient: [Color(hex: 0x0E1B4A), Color(hex: 0x1F3590), Color(hex: 0x4A6BC4)],
                border: Color(hex: 0xC2D9FF).opacity(0.45),
                accent: Color(hex: 0xDDE6FF), soft: Color(hex: 0xEAEEFB).opacity(0.8),
                faded: Color(hex: 0xDDE6FF).opacity(0.5),
                nameColor: .white,
                avatarBg: .black.opacity(0.25), badgeBg: .white.opacity(0.14)
            )
        case "black":
            return TierStyle(
                label: "Nero",
                gradient: [Color(hex: 0x050505), Color(hex: 0x1A1614), Color(hex: 0x2A1F12)],
                border: Theme.flame.opacity(0.35),
                accent: Theme.flame, soft: Theme.flame.opacity(0.7),
                faded: Theme.flame.opacity(0.45),
                nameColor: Theme.parchment,
                avatarBg: .white.opacity(0.08), badgeBg: .white.opacity(0.1)
            )
        default:
            return TierStyle(
                label: "Libero",
                gradient: [Color(hex: 0xF8EFDC), Color(hex: 0xEFE0C3), Color(hex: 0xE5D2A8)],
                border: Color(hex: 0x2A1F12).opacity(0.18),
                accent: Theme.darkRed, soft: Color(hex: 0x2A1F12).opacity(0.65),
                faded: Color(hex: 0x2A1F12).opacity(0.4),
                nameColor: Color(hex: 0x2A1F12),
                avatarBg: .white.opacity(0.55), badgeBg: Color(hex: 0x2A1F12).opacity(0.07)
            )
        }
    }
}

// ── View model (stats) ────────────────────────────────────────────────────────

@MainActor
@Observable
final class ProfileViewModel {
    private(set) var nights: Int?
    private(set) var savedCount: Int?
    private(set) var friendCount: Int?
    private(set) var friendsSub: String?

    func load(api: APIClient, queries: Queries) async {
        // Bookings via PostgREST (the REST route is cookie-only — see Queries).
        async let bookings = (try? queries.myBookings())
        async let favorites = (try? queries.placeFavoriteIds())
        async let friendsData: FriendsData? = try? api.get("/api/friends")

        nights = await bookings?.bookings.count
        savedCount = await favorites?.count
        if let friends = await friendsData {
            friendCount = friends.friends.count
            friendsSub = friends.incoming.isEmpty
                ? "\(friends.friends.count)"
                : "\(friends.friends.count) · \(friends.incoming.count) ⏳"
        }
    }
}
