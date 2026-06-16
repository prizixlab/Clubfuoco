import SwiftUI
import Observation

/// Native port of the bookings ("Tickets") page: tonight / upcoming / past
/// sections across bookings, guest-list signups and ticket orders, QR
/// fullscreen, and booking cancellation with refund toast.
/// Groups strip and post-visit surveys are Phase 2 social surfaces.
struct BookingsView: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var model = BookingsViewModel()
    @State private var qrBooking: Booking?
    @State private var detailBooking: Booking?
    @State private var openGroup: GroupListItem?
    #if DEBUG
    @State private var debugGroup: GroupListItem?
    #endif

    var body: some View {
        Group {
            switch model.state {
            case .idle, .loading:
                ProgressView(locale.t("common.loading"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                VStack(spacing: 12) {
                    Text(message)
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.stone)
                        .multilineTextAlignment(.center)
                    Button(locale.t("common.retry")) {
                        Task { await model.load(api: api, queries: auth.queries) }
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.ink)
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                if model.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
        }
        .background(Theme.cream, ignoresSafeAreaEdges: .all)
        .navigationTitle(locale.t("nav.tickets"))
        // Match the nav-bar background to the page so the large-title / status-bar
        // area doesn't render in the system white against the cream content.
        .toolbarBackground(Theme.cream, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task {
            await model.load(api: api, queries: auth.queries)
            #if DEBUG
            if ProcessInfo.processInfo.environment["CF_TEST_OPEN_FIRST_GROUP"] == "1" {
                debugGroup = model.groups.first
            }
            #endif
        }
        .onAppear {
            // Refresh when returning to the tab (e.g. after booking in Explore).
            // Silent — keeps showing current data while it reloads.
            if case .loaded = model.state {
                Task { await model.load(api: api, queries: auth.queries) }
            }
        }
        #if DEBUG
        .fullScreenCover(item: $debugGroup) { group in
            NavigationStack { GroupDetailView(groupId: group.id, presentedModally: true) }
        }
        #endif
        .sheet(item: $qrBooking) { booking in
            qrSheet(booking)
        }
        .fullScreenCover(item: $detailBooking) { booking in
            BookingDetailView(
                booking: booking,
                group: groupFor(booking),
                canCancel: canCancel(booking),
                onConfirmCancel: {
                    detailBooking = nil
                    Task { await model.cancel(booking, api: api, queries: auth.queries, locale: locale) }
                },
                onOpenGroup: { group in
                    detailBooking = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { openGroup = group }
                }
            )
        }
        .sheet(item: $openGroup) { group in
            NavigationStack { GroupDetailView(groupId: group.id, presentedModally: true) }
                .presentationDragIndicator(.visible)
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                Text(toast)
                    .font(.cfSans(13, weight: .medium))
                    .foregroundStyle(Theme.cream)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(Theme.ink, in: .capsule)
                    .padding(.bottom, 20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: model.toast)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "ticket")
                .font(.system(size: 36))
                .foregroundStyle(Theme.sand)
            Text(locale.t("bookings.empty"))
                .font(.cfSans(14))
                .foregroundStyle(Theme.stone)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !model.tonight.isEmpty {
                    section(locale.t("bookings.tonight"), items: model.tonight, tonight: true)
                }
                if !model.upcoming.isEmpty {
                    section(locale.t("bookings.upcoming"), items: model.upcoming, tonight: false)
                }
                if model.hasPast {
                    Button {
                        withAnimation { model.showPast.toggle() }
                    } label: {
                        Kicker(locale.t(model.showPast ? "bookings.hidePast" : "bookings.showPast"), color: Theme.fadedSand)
                    }
                    .padding(.horizontal, 20)

                    if model.showPast {
                        section(locale.t("bookings.past"), items: model.past, tonight: false)
                            .opacity(0.6)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 16)
        }
        .refreshable { await model.load(api: api, queries: auth.queries) }
    }

    private func section(_ title: String, items: [BookingsViewModel.Item], tonight: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker(title, color: tonight ? Theme.wine : Theme.fadedSand)
                .padding(.horizontal, 20)

            ForEach(items) { item in
                switch item {
                case .booking(let booking):
                    bookingCard(booking, tonight: tonight)
                case .signup(let signup):
                    signupCard(signup)
                case .ticket(let order):
                    ticketCard(order)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    // ── Cards ─────────────────────────────────────────────────────────────────

    /// The group night this booking belongs to, if any — a group entry is a
    /// normal booking, so we match it to a group by club + date.
    private func groupFor(_ booking: Booking) -> GroupListItem? {
        guard let clubId = booking.club?.id else { return nil }
        return model.groups.first { $0.clubId == clubId && $0.bookingDate == booking.bookingDate }
    }

    private func bookingCard(_ booking: Booking, tonight: Bool) -> some View {
        let isCancelled = booking.status == "cancelled"
        let isLive = tonight && !isCancelled
        let group = groupFor(booking)

        return VStack(spacing: 0) {
            // ── Hero (tap to open the group when this is a group night) ────────
            ZStack(alignment: .topLeading) {
                Color(hex: 0x2A1F1A)
                    .overlay {
                        if let url = booking.club?.coverImageUrl.flatMap(URL.init(string:)) {
                            CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0x2A1F1A) }
                        }
                    }
                    .frame(height: 140)
                    .clipped()
                    .overlay(
                        LinearGradient(colors: [.black.opacity(0.1), .black.opacity(0.65)],
                                       startPoint: .top, endPoint: .bottom)
                    )

                VStack(alignment: .leading) {
                    HStack {
                        if group != nil {
                            Text(locale.t("bookings.groupTag").uppercased())
                                .font(.cfSans(9, weight: .semibold))
                                .kerning(0.8)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(.white.opacity(0.22), in: .capsule)
                        } else {
                            Text(locale.t("bookings.nightlife"))
                                .font(.cfSans(10))
                                .foregroundStyle(.white.opacity(0.85))
                        }
                        Spacer()
                        heroBadge(isCancelled: isCancelled, isLive: isLive)
                    }
                    Spacer()
                    Text(booking.club?.name ?? "—")
                        .font(.cfSerif(22, italic: true))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(formatDate(booking.bookingDate))
                        .font(.cfSans(12))
                        .foregroundStyle(.white.opacity(0.7))
                }
                .padding(12)
            }
            .frame(height: 140)

            // ── Perforation ───────────────────────────────────────────────────
            TicketPerforation()

            // ── Stub ──────────────────────────────────────────────────────────
            VStack(spacing: 14) {
                HStack(spacing: 8) {
                    factCell(locale.t("bookings.factDate"), shortDate(booking.bookingDate))
                    factCell(locale.t("bookings.factDoors"), "23:00")
                    factCell(locale.t("bookings.factGuests"), "\(booking.partySize)")
                    factCell(locale.t("bookings.factTicket"), locale.t(booking.bookingType == "vip" ? "bookings.vip" : "bookings.general"))
                }

                if !isCancelled, let token = booking.qrCodeToken {
                    HStack(spacing: 12) {
                        Button {
                            Haptics.tap()
                            qrBooking = booking
                        } label: {
                            QRCodeView(token: token)
                                .frame(width: 46, height: 46)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(locale.t("bookings.atDoor"))
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.stone)
                            if let total = booking.totalAmount, total > 0 {
                                Text("€\(String(format: "%.2f", total))")
                                    .font(.cfSans(13, weight: .semibold))
                                    .foregroundStyle(Theme.ink)
                            }
                        }
                        Spacer()
                        Button {
                            Haptics.tap()
                            qrBooking = booking
                        } label: {
                            Text(locale.t("bookings.showQR"))
                                .font(.cfSans(12, weight: .semibold))
                                .foregroundStyle(Theme.cream)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(Theme.ink, in: .capsule)
                        }
                    }

                    HStack(spacing: 10) {
                        WalletPassButton(passPath: "/api/bookings/\(booking.id.uuidString.lowercased())/wallet", compact: true)
                        Spacer()
                        CancelConfirmButton {
                            Task { await model.cancel(booking, api: api, queries: auth.queries, locale: locale) }
                        } label: {
                            Text(locale.t("common.cancel"))
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.wine)
                        }
                    }
                }

                if let group {
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    Button {
                        Haptics.tap()
                        openGroup = group
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "person.2.fill")
                                .font(.system(size: 12))
                            Text(locale.t("bookings.seeWhosGoing"))
                                .font(.cfSans(13, weight: .medium))
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.fadedSand)
                        }
                        .foregroundStyle(Theme.ink)
                    }
                }
            }
            .padding(16)
        }
        .background(Color.white)
        .overlay(alignment: .leading) {
            if isLive { Rectangle().fill(Theme.wine).frame(width: 3) }
        }
        .clipShape(.rect(cornerRadius: 16))
        .shadow(color: Color(hex: 0x221E1A).opacity(0.08), radius: 8, y: 2)
        .opacity(isCancelled ? 0.6 : 1)
        .contentShape(Rectangle())
        .onTapGesture {
            Haptics.tap()
            detailBooking = booking
        }
    }

    /// Cancelling is allowed for upcoming bookings that aren't already cancelled.
    private func canCancel(_ booking: Booking) -> Bool {
        let today = DateFormatter()
        today.dateFormat = "yyyy-MM-dd"
        return booking.status != "cancelled" && booking.bookingDate >= today.string(from: Date())
    }

    private func heroBadge(isCancelled: Bool, isLive: Bool) -> some View {
        let (text, fg, bg): (String, Color, Color) =
            isLive ? (locale.t("bookings.tonightBadge"), Color(hex: 0x16A34A), Color(hex: 0x22C55E).opacity(0.18))
            : isCancelled ? (locale.t("bookings.statusCancelled"), Color(hex: 0x888888), Color(hex: 0x787878).opacity(0.25))
            : (locale.t("bookings.statusConfirmed"), .white, .black.opacity(0.3))
        return Text(text.uppercased())
            .font(.cfSans(9, weight: .semibold))
            .kerning(0.8)
            .foregroundStyle(fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(bg, in: .capsule)
            .overlay(Capsule().stroke(fg.opacity(0.3)))
    }

    private func factCell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.cfMono(9))
                .kerning(0.8)
                .foregroundStyle(Theme.fadedSand)
            Text(value)
                .font(.cfSans(14, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func shortDate(_ value: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: value) else { return value }
        let f = DateFormatter()
        f.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        f.setLocalizedDateFormatFromTemplate("d MMM")
        return f.string(from: date)
    }

    private func signupCard(_ signup: GuestSignup) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "star.circle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Theme.gold)
            VStack(alignment: .leading, spacing: 3) {
                Text(signup.guestList?.eventName ?? locale.t("bookings.guestList"))
                    .font(.cfSerif(18))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text("\(locale.t("bookings.guestList")) · \(formatDate(signup.guestList?.eventDate ?? "")) · \(String(format: locale.t("bookings.partyOf"), signup.partySize ?? 1))")
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.fadedSand)
            }
            Spacer()
            statusChip(signup.checkedIn == true ? "checked_in" : (signup.status ?? "confirmed"))
        }
        .padding(14)
        .background(Color.white)
        .clipShape(.rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
    }

    private func ticketCard(_ order: TicketOrder) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "ticket.fill")
                .font(.system(size: 24))
                .foregroundStyle(Theme.wine)
            VStack(alignment: .leading, spacing: 3) {
                Text(order.eventName ?? "—")
                    .font(.cfSerif(18))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text([order.venueName, formatDate(order.eventDate ?? ""),
                      String(format: locale.t("bookings.tickets"), order.quantity ?? 1)]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.fadedSand)
                    .lineLimit(2)
            }
            Spacer()
            if let cents = order.totalCents {
                Text("€\(String(format: "%.2f", Double(cents) / 100))")
                    .font(.cfSans(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
            }
        }
        .padding(14)
        .background(Color.white)
        .clipShape(.rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
    }

    private func statusChip(_ status: String) -> some View {
        let (key, color): (String, Color) = switch status {
        case "confirmed": ("bookings.statusConfirmed", Color(hex: 0x2D7A46))
        case "pending": ("bookings.statusPending", Theme.gold)
        case "cancelled": ("bookings.statusCancelled", Theme.fadedSand)
        case "checked_in": ("bookings.statusCheckedIn", Color(hex: 0x2D7A46))
        default: ("bookings.statusPending", Theme.fadedSand)
        }
        return Text(locale.t(key).uppercased())
            .font(.cfSans(8.5, weight: .semibold))
            .kerning(1)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.1), in: .capsule)
    }

    // ── Fullscreen QR ─────────────────────────────────────────────────────────

    private func qrSheet(_ booking: Booking) -> some View {
        VStack(spacing: 20) {
            Kicker("CLUB FUOCO · \(booking.club?.name ?? "")")
                .padding(.top, 32)

            Text(formatDate(booking.bookingDate))
                .font(.cfSerif(28))
                .foregroundStyle(Theme.ink)

            if let token = booking.qrCodeToken {
                QRCodeView(token: token)
                    .frame(width: 260, height: 260)
                    .padding(20)
                    .background(Color.white, in: .rect(cornerRadius: 20))
            }

            Text(locale.t("bookings.atDoor"))
                .font(.cfSerif(16, italic: true))
                .foregroundStyle(Theme.stone)

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(Theme.cream)
        .presentationDetents([.large])
    }

    private func formatDate(_ value: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        formatter.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return formatter.string(from: date)
    }
}

/// A Cancel button that confirms inline via a small popover anchored to the
/// button itself (so the prompt appears right where the user tapped, not as a
/// detached sheet). Runs `perform` only after "Yes, cancel".
struct CancelConfirmButton<Label: View>: View {
    @Environment(LocaleStore.self) private var locale
    let perform: () -> Void
    @ViewBuilder var label: () -> Label
    @State private var show = false

    var body: some View {
        Button {
            Haptics.tap()
            show = true
        } label: {
            label()
        }
        .popover(isPresented: $show) {
            VStack(spacing: 0) {
                Text(locale.t("bookings.cancelQuestion"))
                    .font(.cfSans(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                Divider()
                Button {
                    // Dismiss the popover first; only then run the cancel, which
                    // removes this button from the hierarchy. Acting while the
                    // popover is still up orphans its anchor and leaves a ghost.
                    show = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { perform() }
                } label: {
                    Text(locale.t("bookings.yesCancel"))
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(Theme.wine)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                Divider()
                Button {
                    show = false
                } label: {
                    Text(locale.t("bookings.keep"))
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.stone)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
            }
            .frame(width: 230)
            .presentationCompactAdaptation(.popover)
        }
    }
}

/// The ticket "tear" — a dashed line with cream notches punched into each
/// edge (matching Perforation in the web bookings page).
struct TicketPerforation: View {
    var body: some View {
        ZStack {
            DashedLine()
                .stroke(Color(hex: 0xE8E2D8), style: StrokeStyle(lineWidth: 2, dash: [6, 5]))
                .frame(height: 2)
                .padding(.horizontal, 12)
            HStack {
                notch.offset(x: -10)   // centered on the card's edge → half is
                Spacer()               // clipped away, leaving a punched notch
                notch.offset(x: 10)
            }
        }
        .frame(height: 20)
        .background(Color.white)
    }

    private var notch: some View {
        Circle()
            .fill(Theme.cream)
            .frame(width: 20, height: 20)
    }
}

/// A horizontal line centered vertically — for the dashed perforation.
private struct DashedLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

// ── View model ────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class BookingsViewModel {
    enum LoadState {
        case idle, loading, loaded
        case failed(String)
    }

    enum Item: Identifiable {
        case booking(Booking)
        case signup(GuestSignup)
        case ticket(TicketOrder)

        var id: UUID {
            switch self {
            case .booking(let b): return b.id
            case .signup(let s): return s.id
            case .ticket(let t): return t.id
            }
        }
    }

    private(set) var state: LoadState = .idle
    private(set) var data: BookingsResponse?
    private(set) var groups: [GroupListItem] = []
    var showPast = false
    var toast: String?

    var isEmpty: Bool {
        guard let data else { return true }
        return data.bookings.isEmpty && data.guestSignups.isEmpty && data.ticketOrders.isEmpty
    }

    func load(api: APIClient, queries: Queries) async {
        if data == nil { state = .loading }
        // Bookings come from PostgREST directly (RLS-scoped). Groups stay on
        // the REST route — it uses the service client + manual scoping, so it
        // works for native Bearer requests.
        async let groupList: [GroupListItem]? = try? await api.get("/api/groups")
        do {
            data = try await queries.myBookings()
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
        groups = (await groupList ?? []).filter { $0.status != "cancelled" }
    }

    // ── Tonight / upcoming / past partitions (mirror the page logic) ─────────

    private var todayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    var tonight: [Item] {
        guard let data else { return [] }
        let today = todayString
        return data.bookings.filter { $0.bookingDate == today && $0.status != "cancelled" }.map(Item.booking)
            + data.guestSignups.filter { $0.guestList?.eventDate == today && $0.checkedIn != true && $0.status != "cancelled" }.map(Item.signup)
            + data.ticketOrders.filter { $0.eventDate == today && $0.status != "payment_failed" }.map(Item.ticket)
    }

    var upcoming: [Item] {
        guard let data else { return [] }
        let today = todayString
        return data.bookings.filter { $0.bookingDate > today && $0.status != "cancelled" }.map(Item.booking)
            + data.guestSignups.filter { ($0.guestList?.eventDate ?? "") > today && $0.checkedIn != true && $0.status != "cancelled" }.map(Item.signup)
            + data.ticketOrders.filter { $0.status != "payment_failed" && ($0.eventDate == nil || $0.eventDate! > today) }.map(Item.ticket)
    }

    var past: [Item] {
        guard let data else { return [] }
        let today = todayString
        return data.bookings.filter { $0.bookingDate < today || $0.status == "cancelled" }.map(Item.booking)
            + data.guestSignups.filter { $0.guestList == nil || ($0.guestList?.eventDate ?? "") < today || $0.checkedIn == true || $0.status == "cancelled" }.map(Item.signup)
            + data.ticketOrders.filter { $0.status != "payment_failed" && ($0.eventDate ?? "9999") < today }.map(Item.ticket)
    }

    var hasPast: Bool { !past.isEmpty }

    // ── Cancel (DELETE /api/bookings/{id}) ───────────────────────────────────

    private struct CancelResult: Decodable, Sendable {
        let refundAmount: Double?

        // The API returns refund_amount as a formatted string ("28.50"); accept
        // a number too so decoding never fails on a successful cancel.
        enum CodingKeys: String, CodingKey { case refundAmount }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let string = try? c.decode(String.self, forKey: .refundAmount) {
                refundAmount = Double(string)
            } else {
                refundAmount = try? c.decode(Double.self, forKey: .refundAmount)
            }
        }
    }

    func cancel(_ booking: Booking, api: APIClient, queries: Queries, locale: LocaleStore) async {
        let isFree = (booking.totalAmount ?? 0) == 0
        do {
            // DELETE route uses the Bearer-authed client + Stripe refund, so it
            // works natively (unlike GET, which is cookie-only).
            let result: CancelResult = try await api.delete("/api/bookings/\(booking.id.uuidString.lowercased())")
            Haptics.success()
            showToast(isFree
                ? locale.t("bookings.cancelled")
                : String(format: locale.t("bookings.refund"), String(format: "%.2f", result.refundAmount ?? 0)))
            await load(api: api, queries: queries)
        } catch {
            Haptics.error()
            showToast(error.localizedDescription)
        }
    }

    private func showToast(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(3.5))
            toast = nil
        }
    }
}
