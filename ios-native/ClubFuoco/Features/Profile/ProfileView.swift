import SwiftUI
import Observation
import PhotosUI
import UIKit

/// Native profile page: CLUB FUOCO · ACCOUNT header, identity card (avatar +
/// name + member-number), stats strip, menu sections, sign out, footer.
struct ProfileView: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var model = ProfileViewModel()
    @State private var avatarItem: PhotosPickerItem?
    @State private var cropImage: IdentifiableImage?
    @State private var uploadingAvatar = false
    #if DEBUG
    // CF_TEST_PUSH=settings|friends|notifications|fiamme
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
                            .background(Theme.surface, in: .circle)
                    }
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.stone)
                            .frame(width: 36, height: 36)
                            .background(Theme.surface, in: .circle)
                    }
                }
                .padding(.init(top: 8, leading: 20, bottom: 12, trailing: 20))

                identityCard
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
        .onChange(of: avatarItem) {
            guard let item = avatarItem else { return }
            avatarItem = nil
            Task { await loadForCrop(item) }
        }
        .fullScreenCover(item: $cropImage) { wrapper in
            AvatarCropView(image: wrapper.image) {
                cropImage = nil
            } onConfirm: { jpeg in
                cropImage = nil
                Task { await uploadAvatar(jpeg) }
            }
        }
    }

    /// Load the picked photo into memory and hand it to the crop editor.
    private func loadForCrop(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else {
            Haptics.error()
            return
        }
        cropImage = IdentifiableImage(image: image)
    }

    /// Upload the already-cropped 512px JPEG to the avatar endpoint; the profile
    /// refresh pulls back the new cache-busted URL.
    private func uploadAvatar(_ jpeg: Data) async {
        uploadingAvatar = true
        defer { uploadingAvatar = false }
        struct Body: Encodable { let image: String }
        struct Result: Decodable, Sendable { let avatarUrl: String }
        do {
            let _: Result = try await api.post("/api/account/avatar", body: Body(image: jpeg.base64EncodedString()))
            await auth.refreshProfile()
            Haptics.success()
        } catch {
            Haptics.error()
        }
    }

    // ── Identity card ─────────────────────────────────────────────────────────

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

    private var identityCard: some View {
        let parts = nameParts
        let cream = Color(hex: 0xF8EFDC)
        let muted = Color(hex: 0x2A1F12).opacity(0.55)
        return ZStack {
            LinearGradient(
                colors: [cream, Color(hex: 0xEFE0C3), Color(hex: 0xE5D2A8)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )

            VStack {
                HStack {
                    Kicker("N° \(memberNumber.prefix(2))", color: muted, size: 8.5)
                    Spacer()
                    Kicker("BARCELONA", color: muted, size: 8.5)
                }
                Spacer()
                HStack {
                    Kicker("EST. \(memberYear)", color: muted, size: 8.5)
                    Spacer()
                    Kicker("N° \(memberNumber)", color: muted, size: 8.5)
                }
            }
            .padding(14)

            VStack(alignment: .leading, spacing: 10) {
                // Tap to pick a profile photo (out-of-process system picker —
                // no photo-library permission prompt needed).
                PhotosPicker(selection: $avatarItem, matching: .images) {
                    ZStack(alignment: .bottomTrailing) {
                        Circle()
                            .fill(Theme.surface.opacity(0.55))
                            .frame(width: 84, height: 84)
                            .overlay {
                                if let avatar = auth.profile?.avatarUrl, let url = URL(string: avatar) {
                                    CachedAsyncImage(url: url) {
                                        $0.resizable().aspectRatio(contentMode: .fill)
                                    } placeholder: {
                                        Text(parts.initials)
                                            .font(.cfSerif(42, italic: true))
                                            .foregroundStyle(Theme.darkRed)
                                    }
                                    .frame(width: 84, height: 84)
                                    .clipShape(.circle)
                                } else {
                                    Text(parts.initials)
                                        .font(.cfSerif(42, italic: true))
                                        .foregroundStyle(Theme.darkRed)
                                }
                            }
                            .overlay {
                                if uploadingAvatar {
                                    Circle().fill(.black.opacity(0.35))
                                    ProgressView().tint(.white)
                                }
                            }

                        Image(systemName: "camera.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.cream)
                            .frame(width: 24, height: 24)
                            .background(Theme.ink, in: .circle)
                            .overlay(Circle().stroke(cream, lineWidth: 2))
                            .offset(x: 2, y: 2)
                    }
                }
                .buttonStyle(.plain)
                .disabled(uploadingAvatar)

                VStack(alignment: .leading, spacing: 0) {
                    Text(parts.first.isEmpty ? "—" : parts.first)
                        .font(.cfSerif(36))
                        .foregroundStyle(Theme.ink)
                    if !parts.last.isEmpty {
                        Text(parts.last)
                            .font(.cfSerif(36, italic: true))
                            .foregroundStyle(Theme.darkRed)
                    }
                }
                .padding(.top, 6)

                Text(auth.profile?.email ?? auth.user?.email ?? "")
                    .font(.cfSans(10))
                    .kerning(1.2)
                    .foregroundStyle(muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.init(top: 36, leading: 20, bottom: 40, trailing: 20))
        }
        .clipShape(.rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0x2A1F12).opacity(0.18)))
        // The membership card is a fixed cream/gold artifact in both modes, so
        // pin the subtree to Light — otherwise the adaptive tokens inside it
        // (the name, the camera badge) invert and disappear into the card.
        .environment(\.colorScheme, .light)
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
                        sub: model.bookingsTotal.map { String(format: locale.t($0 == 1 ? "profile.bookingsCountOne" : "profile.bookingsCount"), $0) } ?? "—")
            }
            menuRowDivider
            NavigationLink {
                SavedClubsView()
            } label: {
                menuRow(n: "02", icon: "heart.fill",
                        label: locale.t("profile.savedClubs"),
                        sub: model.savedCount.map { String(format: locale.t("profile.savedCount"), $0) } ?? "—")
            }
            menuRowDivider
            NavigationLink {
                FriendsView()
            } label: {
                menuRow(n: "03", icon: "person.2.fill",
                        label: locale.t("profile.friends"),
                        sub: model.friendsSub ?? "—")
            }

            Rectangle().fill(Theme.ink.opacity(0.16)).frame(height: 1)
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
            Link(destination: LegalURLs.terms) {
                menuRow(n: "06", icon: "text.book.closed.fill",
                        label: locale.t("profile.terms"),
                        sub: locale.t("profile.termsSub"))
            }
            menuRowDivider
            Link(destination: LegalURLs.privacy) {
                menuRow(n: "07", icon: "lock.shield.fill",
                        label: locale.t("profile.privacy"),
                        sub: locale.t("profile.privacySub"))
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

    private func menuRow(n: String, icon: String, label: String, sub: String) -> some View {
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
            Image(systemName: "arrow.right")
                .font(.system(size: 12))
                .foregroundStyle(Theme.fadedSand)
        }
        .padding(.vertical, 14)
        .contentShape(.rect)
    }
}

// ── View model (stats) ────────────────────────────────────────────────────────

@MainActor
@Observable
final class ProfileViewModel {
    /// "Nights out" score — a lifetime, ever-growing tally across every kind of
    /// night (bookings, guestlist signups, ticket orders). Meant to feel full
    /// and climb over time, like a Snap score. Never counts down.
    private(set) var nights: Int?
    /// Total paid bookings — the subtitle on the My Bookings row.
    private(set) var bookingsTotal: Int?
    private(set) var savedCount: Int?
    private(set) var friendCount: Int?
    private(set) var friendsSub: String?

    func load(api: APIClient, queries: Queries) async {
        // Bookings via PostgREST (the REST route is cookie-only — see Queries).
        async let bookings = (try? queries.myBookings())
        async let favorites = (try? queries.placeFavoriteIds())
        async let friendsData: FriendsData? = try? api.get("/api/friends")

        if let data = await bookings {
            // Every night counts toward the score — paid bookings, guestlist
            // signups, and ticket orders alike.
            nights = data.bookings.count + data.guestSignups.count + data.ticketOrders.count
            bookingsTotal = data.bookings.count
        }
        savedCount = await favorites?.count
        if let friends = await friendsData {
            friendCount = friends.friends.count
            friendsSub = friends.incoming.isEmpty
                ? "\(friends.friends.count)"
                : "\(friends.friends.count) · \(friends.incoming.count) ⏳"
        }
    }
}

/// Identity wrapper so a picked `UIImage` can drive `.fullScreenCover(item:)`.
struct IdentifiableImage: Identifiable {
    let id = UUID()
    let image: UIImage
}

/// Circular-crop editor: pan + pinch-zoom the picked photo inside a fixed
/// circle, then Confirm to hand back a square 512px JPEG for upload.
private struct AvatarCropView: View {
    let image: UIImage
    var onCancel: () -> Void
    var onConfirm: (Data) -> Void

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    private let cropSide: CGFloat = 300
    private let minScale: CGFloat = 1
    private let maxScale: CGFloat = 6

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onCancel) {
                    Text("Cancel").font(.cfSans(15, weight: .medium))
                }
                Spacer()
                Text("Adjust photo").font(.cfSans(15, weight: .semibold))
                Spacer()
                Button {
                    if let jpeg = renderCrop() {
                        Haptics.tap()
                        onConfirm(jpeg)
                    } else {
                        Haptics.error()
                    }
                } label: {
                    Text("Use").font(.cfSans(15, weight: .semibold))
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)

            Spacer()

            // Pan/zoom stage with a circular focus ring and dimmed surround.
            ZStack {
                imageLayer
                    .frame(width: cropSide, height: cropSide)
                    .clipped()

                Rectangle()
                    .fill(.black.opacity(0.6))
                    .mask {
                        Rectangle()
                            .overlay {
                                Circle()
                                    .frame(width: cropSide, height: cropSide)
                                    .blendMode(.destinationOut)
                            }
                            .compositingGroup()
                    }
                    .allowsHitTesting(false)

                Circle()
                    .strokeBorder(.white.opacity(0.9), lineWidth: 2)
                    .frame(width: cropSide, height: cropSide)
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .gesture(
                SimultaneousGesture(
                    MagnifyGesture()
                        .onChanged { v in
                            scale = min(max(lastScale * v.magnification, minScale), maxScale)
                        }
                        .onEnded { _ in lastScale = scale },
                    DragGesture()
                        .onChanged { v in
                            offset = CGSize(width: lastOffset.width + v.translation.width,
                                            height: lastOffset.height + v.translation.height)
                        }
                        .onEnded { _ in lastOffset = offset }
                )
            )

            Spacer()

            Text("Drag to reposition · pinch to zoom")
                .font(.cfSans(13))
                .foregroundStyle(.white.opacity(0.55))
                .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
    }

    /// The photo scaled to fill the crop square, then transformed by the
    /// user's pinch/drag. Reused verbatim for on-screen preview and render.
    private var imageLayer: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: cropSide, height: cropSide)
            .scaleEffect(scale)
            .offset(offset)
    }

    /// Rasterize exactly what's inside the crop square at 512px and JPEG-encode.
    @MainActor
    private func renderCrop() -> Data? {
        let content = imageLayer
            .frame(width: cropSide, height: cropSide)
            .clipped()
        let renderer = ImageRenderer(content: content)
        renderer.proposedSize = ProposedViewSize(width: cropSide, height: cropSide)
        renderer.scale = 512 / cropSide
        return renderer.uiImage?.jpegData(compressionQuality: 0.8)
    }
}
