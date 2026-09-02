import SwiftUI
import Observation
import CoreLocation

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
    @State private var reviewBooking: Booking?
    @State private var openInvite: InviteSummary?
    /// A saved event reopened to pay for it — no guest row exists yet, so it
    /// goes through the normal claim sheet rather than the preclaimed path.
    @State private var savedInviteToken: String?
    @State private var tab: TopTab = .tickets
    /// Live pager position, 0 = Tickets … 1 = Reviews — drives the slider
    /// indicator continuously during the swipe.
    @State private var pageProgress: CGFloat = 0
    @State private var showArrivalLocationSheet = false
    private static let arrivalPromptDateKey = "cf.arrivalPromptLastShownAt"

    /// Arrival (Always) prompt — fires on the Tickets tab when there's at
    /// least one upcoming booking and the user hasn't already granted Always.
    /// Lives here, not in BookNightSheet, because BookNightSheet dismisses
    /// the moment the user taps Done — any sheet attached to it tears down
    /// with it. The Tickets tab is the stable parent that always exists by
    /// the time a booking is on the books.
    ///
    /// Re-ask rule: once per NEW booking, not once per install — the old
    /// boolean key meant a single "Not now" silenced auto check-in forever.
    /// Anything upcoming that was created after the previous ask earns one
    /// more nudge.
    private func maybePromptArrival() {
        guard !model.upcoming.isEmpty else { return }
        let status = LocationService.shared.authorizationStatus
        guard status != .authorizedAlways, status != .restricted else { return }
        let defaults = UserDefaults.standard
        if let last = defaults.object(forKey: Self.arrivalPromptDateKey) as? Date {
            guard let newest = model.newestUpcomingCreation, newest > last else { return }
        }
        defaults.set(Date(), forKey: Self.arrivalPromptDateKey)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 600_000_000)
            showArrivalLocationSheet = true
        }
    }
    #if DEBUG
    @State private var debugGroup: GroupListItem?
    #endif

    private enum TopTab: String, CaseIterable, Identifiable {
        case tickets, reviews
        var id: String { rawValue }
        var label: String {
            switch self {
            case .tickets: "Tickets"
            case .reviews: "Reviews"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Pinned above the switching content so it exists in every state —
            // the Reviews List previously rendered without any way back.
            topTabSlider

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
                // Always render the list — it contains the promoter-invite
                // ("Guestlists") section, which loads independently of bookings.
                // A user whose only tickets are invites must still see them.
                list
            }
        }
        .background(Theme.cream, ignoresSafeAreaEdges: .all)
        // Native centered bar title. INLINE mode on purpose: the large title
        // got stuck collapsed after the loading→loaded container swap (SwiftUI
        // bug) and only rendered mid-scroll; the inline title always draws.
        .navigationTitle(locale.t("nav.tickets"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.cream, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task {
            await model.load(api: api, queries: auth.queries)
            maybePromptArrival()
            #if DEBUG
            if ProcessInfo.processInfo.environment["CF_TEST_OPEN_FIRST_GROUP"] == "1" {
                debugGroup = model.groups.first
            }
            #endif
        }
        .onChange(of: model.upcoming.count) { _, _ in
            // A booking just landed (or a refresh added one) — re-evaluate
            // without waiting for the next tab visit.
            maybePromptArrival()
        }
        .onChange(of: tab) {
            // The capsule tracks `pageProgress`, which the swipe-offset reader
            // only updates during an interactive drag. Tapping a label (or a
            // swipe settling) changes `tab` WITHOUT emitting drag offsets, so
            // sync the capsule to the settled tab here — otherwise it froze on
            // taps.
            withAnimation(.easeInOut(duration: 0.22)) {
                pageProgress = tab == .reviews ? 1 : 0
            }
        }
        .sheet(isPresented: $showArrivalLocationSheet) {
            LocationPermissionSheet(mode: .arrival)
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
                },
                onAttendanceChanged: {
                    Task { await model.load(api: api, queries: auth.queries) }
                }
            )
        }
        .sheet(item: $openGroup, onDismiss: {
            // Reload so a just-answered invite drops out of the prompt and the
            // tab badge stays in sync.
            Task { await model.load(api: api, queries: auth.queries) }
        }) { group in
            NavigationStack { GroupDetailView(groupId: group.id, presentedModally: true) }
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $openInvite, onDismiss: {
            Task { await model.load(api: api, queries: auth.queries) }
        }) { inv in
            InviteClaimView(
                token: inv.inviteToken,
                preclaimedGuestId: inv.id.uuidString.lowercased(),
                preclaimedName: inv.fullName
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: Binding(
            get: { savedInviteToken.map(SavedToken.init) },
            set: { if $0 == nil { savedInviteToken = nil } }
        ), onDismiss: {
            Task { await model.load(api: api, queries: auth.queries) }
        }) { wrapped in
            InviteClaimView(token: wrapped.value)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $reviewBooking) { booking in
            ReviewSurveySheet(
                booking: booking,
                onSubmitted: { id in
                    // Drop it from pendingReviews instantly so the row
                    // disappears the moment the sheet closes. Background fetch
                    // then catches up the server-side attendance_status.
                    model.markReviewSubmitted(id)
                },
                onDismiss: {
                    Task { await model.load(api: api, queries: auth.queries) }
                }
            )
            .presentationDragIndicator(.visible)
        }
        .onReceive(NotificationCenter.default.publisher(for: .cfMorningAfterTapped)) { notif in
            // Notification tap → flip to the Reviews tab and present the sheet
            // for the booking the notification was scheduled against. If the
            // booking id can't be matched (test fire, account changed), open
            // whatever is at the top of the pending list so something opens.
            withAnimation { tab = .reviews }
            let id = notif.userInfo?["bookingId"] as? UUID
            let match = (id.flatMap { bid in model.allBookings.first { $0.id == bid } })
                ?? model.pendingReviews.first
            reviewBooking = match
            // Tapping the morning-after prompt is itself a soft "probably
            // arrived" signal (→ likely_attended), even if they don't finish.
            if let match {
                let path = "/api/bookings/\(match.id.uuidString.lowercased())/signals"
                struct SBody: Encodable { let kind: String }
                struct SResp: Decodable, Sendable { let attendanceStatus: String? }
                Task { let _: SResp? = try? await api.post(path, body: SBody(kind: "morning_after_opened")) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .cfInviteClaimed)) { _ in
            // A guestlist was just claimed elsewhere — refresh so it appears
            // inline with the bookings.
            Task { await model.load(api: api, queries: auth.queries) }
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

    /// Swipeable pages under the slider. A paging ScrollView instead of a
    /// paged TabView so the live horizontal offset is readable — TabView only
    /// reports selection after the page settles, which made the slider snap
    /// late instead of moving with the finger.
    private var list: some View {
        GeometryReader { geo in
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ticketsList
                        .frame(width: geo.size.width, height: geo.size.height)
                        .id(TopTab.tickets)
                    reviewsList
                        .frame(width: geo.size.width, height: geo.size.height)
                        .id(TopTab.reviews)
                }
                .scrollTargetLayout()
                .background {
                    GeometryReader { inner in
                        Color.clear.preference(
                            key: PagerProgressKey.self,
                            value: -inner.frame(in: .named("ticketsPager")).minX / max(geo.size.width, 1)
                        )
                    }
                }
            }
            .coordinateSpace(name: "ticketsPager")
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: Binding(
                get: { Optional(tab) },
                set: { if let t = $0 { tab = t } }
            ))
            .scrollIndicators(.hidden)
            .onPreferenceChange(PagerProgressKey.self) { pageProgress = $0 }
        }
    }

    /// Segmented slider at the very top of Tickets. One wine capsule slides
    /// between the two labels, riding `pageProgress` so it tracks the swipe
    /// frame by frame. Reviews shows a badge with the pending count.
    private var topTabSlider: some View {
        // Labels flip style at the halfway point of the swipe.
        let active: TopTab = pageProgress < 0.5 ? .tickets : .reviews
        return HStack(spacing: 0) {
            ForEach(TopTab.allCases) { t in
                let isActive = active == t
                Button {
                    Haptics.tap()
                    withAnimation(.easeInOut(duration: 0.22)) { tab = t }
                } label: {
                    HStack(spacing: 8) {
                        Text(t.label)
                            .font(.cfSans(13, weight: isActive ? .semibold : .regular))
                        if t == .reviews, !model.pendingReviews.isEmpty {
                            Text("\(model.pendingReviews.count)")
                                .font(.cfMono(10, weight: .semibold))
                                .foregroundStyle(isActive ? Theme.wine : Theme.cream)
                                .frame(minWidth: 18, minHeight: 18)
                                .background(isActive ? Theme.cream : Theme.wine, in: .circle)
                        }
                    }
                    .foregroundStyle(isActive ? Theme.cream : Theme.ink)
                    .frame(maxWidth: .infinity)
                    .frame(height: 38)
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .background {
            GeometryReader { geo in
                Capsule()
                    .fill(Theme.wine)
                    .frame(width: geo.size.width / 2)
                    .offset(x: geo.size.width / 2 * min(max(pageProgress, 0), 1))
            }
        }
        .padding(4)
        .background(Theme.surface.opacity(0.6), in: .capsule)
        .overlay(Capsule().stroke(Theme.hairline))
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var ticketsList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !model.pendingInvites.isEmpty {
                    invitesSection
                }
                // Saved-but-unpaid sits ABOVE real tickets: it's the only thing
                // on this screen with something still to do.
                SavedEventsSection { token in
                    savedInviteToken = token
                }
                if !model.tonight.isEmpty {
                    section(locale.t("bookings.tonight"), items: model.tonight, tonight: true)
                }
                if !model.upcoming.isEmpty {
                    section(locale.t("bookings.upcoming"), items: model.upcoming, tonight: false)
                }
                // Nothing tonight/upcoming — show a real empty state instead of
                // a bare "SHOW PAST" (which read as a bug).
                if model.tonight.isEmpty && model.upcoming.isEmpty && model.pendingInvites.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "ticket")
                            .font(.system(size: 40))
                            .foregroundStyle(Theme.sand)
                        Text(locale.t("bookings.noUpcoming"))
                            .font(.cfSans(15))
                            .foregroundStyle(Theme.stone)
                        Text(locale.t(model.hasPast ? "bookings.noUpcomingPast" : "bookings.noUpcomingSub"))
                            .font(.cfSans(12))
                            .foregroundStyle(Theme.fadedSand)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 50)
                    .padding(.bottom, 8)
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

    @ViewBuilder private var reviewsList: some View {
        if model.pendingReviews.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "star.bubble")
                    .font(.system(size: 36))
                    .foregroundStyle(Theme.sand)
                    .padding(.top, 40)
                Text("No reviews waiting")
                    .font(.cfSans(14))
                    .foregroundStyle(Theme.stone)
                Text("After a night out, we'll ask you how it went.")
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.fadedSand)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                Section {
                    ForEach(model.pendingReviews) { booking in
                        reviewCard(booking)
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 6, leading: 20, bottom: 6, trailing: 20))
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    Haptics.tap()
                                    withAnimation { model.dismissReview(booking.id, api: api) }
                                } label: {
                                    Label("Dismiss", systemImage: "trash")
                                }
                            }
                    }
                } header: {
                    Kicker("Tell us how it went", color: Theme.wine)
                        .textCase(nil)
                        .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
                }
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.cream)
            .refreshable { await model.load(api: api, queries: auth.queries) }
        }
    }

    // ── Pending friend group invites ──────────────────────────────────────────

    private var invitesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker(locale.t("bookings.invited"), color: Theme.wine)
                .padding(.horizontal, 20)
            VStack(spacing: 12) {
                ForEach(model.pendingInvites) { group in
                    Button {
                        Haptics.tap()
                        openGroup = group
                    } label: {
                        inviteCard(group)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private func inviteCard(_ group: GroupListItem) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Theme.wine.opacity(0.12))
                    .frame(width: 56, height: 56)
                Image(systemName: "person.2.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Theme.wine)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(group.club?.name ?? locale.t("bookings.aNightOut"))
                    .font(.cfSerif(20))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(shortDate(group.bookingDate))
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.stone)
            }
            Spacer(minLength: 8)
            Text(locale.t("bookings.invitedRespond"))
                .font(.cfSans(12, weight: .semibold))
                .foregroundStyle(Theme.cream)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Theme.wine, in: .capsule)
        }
        .padding(14)
        .background(Theme.surface, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.wine.opacity(0.25)))
        .shadow(color: Color(hex: 0x221E1A).opacity(0.05), radius: 6, y: 3)
    }

    private func reviewCard(_ booking: Booking) -> some View {
        Button {
            Haptics.tap()
            reviewBooking = booking
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "star.bubble")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.wine)
                    .frame(width: 36, height: 36)
                    .background(Theme.wine.opacity(0.08), in: .rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(booking.club?.name ?? "Your night out")
                        .font(.cfSerif(17, italic: true))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text("Did you go? Review your night")
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.stone)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.sand)
            }
            .padding(14)
            .background(Theme.surface, in: .rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.wine.opacity(0.25)))
        }
        .buttonStyle(.plain)
    }

    private func section(_ title: String, items: [BookingsViewModel.Item], tonight: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker(title, color: tonight ? Theme.wine : Theme.fadedSand)
                .padding(.horizontal, 20)

            ForEach(items) { item in
                switch item {
                case .booking(let booking):
                    // Only the first upcoming ticket carries the Wallet button
                    // (see the artboard) — on every card it becomes wallpaper.
                    TicketCard(
                        booking: booking,
                        group: groupFor(booking),
                        showWallet: booking.id == model.nextUpBookingID,
                        onShowQR: { qrBooking = booking },
                        onOpenGroup: { if let g = groupFor(booking) { openGroup = g } }
                    )
                    .padding(.horizontal, 20)
                case .signup(let signup):
                    signupCard(signup)
                case .ticket(let order):
                    ticketCard(order)
                case .invite(let inv):
                    Button { openInvite = inv } label: { inviteCard(inv) }
                        .buttonStyle(.plain)
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
        .background(Theme.surface)
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
        .background(Theme.surface)
        .clipShape(.rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
    }

    /// Claimed promoter guestlist — rendered as a booking so it sits inline
    /// with the rest, but tagged with a gold "GUESTLIST" pill so it reads as a
    /// promoter pass rather than a paid reservation.
    private func inviteCard(_ inv: InviteSummary) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 24))
                .foregroundStyle(Theme.gold)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(locale.t("bookings.guestlistTag"))
                        .font(.cfMono(8, weight: .semibold)).kerning(1)
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.gold, in: .capsule)
                    if inv.checkedInAt != nil {
                        statusChip("checked_in")
                    }
                }
                Text(inv.eventTitle)
                    .font(.cfSerif(18))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text([inv.venueName, formatDate(inv.nightDate),
                      inv.plusOnes > 0 ? String(format: locale.t("bookings.partyOf"), inv.plusOnes + 1) : nil]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.fadedSand)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "qrcode")
                .font(.system(size: 20))
                .foregroundStyle(Theme.stone)
        }
        .padding(14)
        .background(Theme.surface)
        .clipShape(.rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.gold.opacity(0.35)))
    }

    private func statusChip(_ status: String) -> some View {
        let (key, color): (String, Color) = switch status {
        case "confirmed": ("bookings.statusConfirmed", Theme.success)
        case "pending": ("bookings.statusPending", Theme.gold)
        case "cancelled": ("bookings.statusCancelled", Theme.fadedSand)
        case "checked_in": ("bookings.statusCheckedIn", Theme.success)
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

            if let token = booking.doorToken {
                QRCodeView(token: token)
                    .frame(width: 260, height: 260)
                    .padding(20)
                    .background(Theme.qrSurface, in: .rect(cornerRadius: 20))
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
        .background(Theme.surface)
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
        case invite(InviteSummary)   // claimed promoter guestlist

        var id: UUID {
            switch self {
            case .booking(let b): return b.id
            case .signup(let s): return s.id
            case .ticket(let t): return t.id
            case .invite(let i): return i.id
            }
        }
    }

    private(set) var state: LoadState = .idle
    private(set) var data: BookingsResponse?
    private(set) var groups: [GroupListItem] = []
    private(set) var invites: [InviteSummary] = []
    var showPast = false
    var toast: String?

    /// Open group nights a friend invited me to that I haven't answered yet.
    /// These drive the Tickets tab badge; surfaced as an actionable prompt so
    /// the badge isn't a dead-end.
    var pendingInvites: [GroupListItem] {
        groups.filter { $0.status == "open" && $0.myRsvp == "invited" }
    }

    var isEmpty: Bool {
        guard let data else { return true }
        return data.bookings.isEmpty && data.guestSignups.isEmpty
            && data.ticketOrders.isEmpty && invites.isEmpty
    }

    func load(api: APIClient, queries: Queries) async {
        if data == nil { state = .loading }
        // Bookings come from PostgREST directly (RLS-scoped). Groups + claimed
        // promoter guestlists stay on their REST routes — they use the service
        // client + manual scoping, so they work for native Bearer requests.
        async let groupList: [GroupListItem]? = try? await api.get("/api/groups")
        async let inviteResp: InvitesResponse? = try? await api.get("/api/promoter-invites/mine")
        do {
            data = try await queries.myBookings()
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
        // Stale-while-revalidate, mirroring how `data` is preserved on a failed
        // refresh above. `try?` yields nil on a transient failure (network blip,
        // timeout, 5xx) — only overwrite when the fetch actually SUCCEEDED, so a
        // flaky request never blanks a claimed party or group invite from the
        // list. A genuine empty result decodes to a non-nil response with an
        // empty array, so real deletions still clear correctly.
        if let g = await groupList { groups = g.filter { $0.status != "cancelled" } }
        if let resp = await inviteResp { invites = resp.invites }
        // Re-sync background geofences against the fresh booking list — picks
        // up newly-booked nights and drops cancelled or past ones. No-op when
        // the user hasn't granted Always.
        await LocationService.shared.syncGeofences()
        // Same reconciliation for the 10am-next-day "did you get in?" prompt.
        await NotificationService.shared.syncMorningAfter(for: data?.bookings ?? [])
    }

    // ── Tonight / upcoming / past partitions (mirror the page logic) ─────────

    private var todayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    /// The one ticket that gets the Wallet button — tonight's if there is one,
    /// otherwise the soonest upcoming. Putting it on every card turns a
    /// deliberate action into wallpaper.
    var nextUpBookingID: UUID? {
        guard let data else { return nil }
        let today = todayString
        let live = data.bookings
            .filter { $0.bookingDate >= today && $0.status != "cancelled" }
            .sorted { $0.bookingDate < $1.bookingDate }
        return live.first?.id
    }

    /// Night ids the user already holds a BOOKING for.
    ///
    /// A feed reservation writes two rows on purpose — a booking (the guest's
    /// record) and a promoter_guests row (the door's list) — and the guest row
    /// comes back from /api/promoter-invites/mine as an invite. Both would land
    /// on Tickets, so the same night appeared twice: once as a full ticket and
    /// once as a bare guest-list strip. The booking is the richer of the two,
    /// so the invite is the one that gives way.
    private var bookedNightIDs: Set<String> {
        guard let data else { return [] }
        return Set(data.bookings
            .filter { $0.status != "cancelled" }
            .compactMap { $0.event?.id?.lowercased() })
    }

    private func unbooked(_ list: [InviteSummary]) -> [InviteSummary] {
        let booked = bookedNightIDs
        return list.filter { !booked.contains($0.allocation.night.id.uuidString.lowercased()) }
    }

    var tonight: [Item] {
        guard let data else { return [] }
        let today = todayString
        return data.bookings.filter { $0.bookingDate == today && $0.status != "cancelled" }.map(Item.booking)
            + data.guestSignups.filter { $0.guestList?.eventDate == today && $0.checkedIn != true && $0.status != "cancelled" }.map(Item.signup)
            + data.ticketOrders.filter { $0.eventDate == today && $0.status != "payment_failed" }.map(Item.ticket)
            + unbooked(invites).filter { $0.nightDate == today && $0.checkedInAt == nil }.map(Item.invite)
    }

    var upcoming: [Item] {
        guard let data else { return [] }
        let today = todayString
        return data.bookings.filter { $0.bookingDate > today && $0.status != "cancelled" }.map(Item.booking)
            + data.guestSignups.filter { ($0.guestList?.eventDate ?? "") > today && $0.checkedIn != true && $0.status != "cancelled" }.map(Item.signup)
            + data.ticketOrders.filter { $0.status != "payment_failed" && ($0.eventDate == nil || $0.eventDate! > today) }.map(Item.ticket)
            + unbooked(invites).filter { $0.nightDate > today && $0.checkedInAt == nil }.map(Item.invite)
    }

    var past: [Item] {
        guard let data else { return [] }
        let today = todayString
        return data.bookings.filter { $0.bookingDate < today || $0.status == "cancelled" }.map(Item.booking)
            + data.guestSignups.filter { $0.guestList == nil || ($0.guestList?.eventDate ?? "") < today || $0.checkedIn == true || $0.status == "cancelled" }.map(Item.signup)
            + data.ticketOrders.filter { $0.status != "payment_failed" && ($0.eventDate ?? "9999") < today }.map(Item.ticket)
            + invites.filter { $0.nightDate < today || $0.checkedInAt != nil }.map(Item.invite)
    }

    var hasPast: Bool { !past.isEmpty }

    /// Newest created_at across upcoming items — drives the "re-ask once per
    /// new booking" arrival-prompt rule.
    var newestUpcomingCreation: Date? {
        let stamps: [String] = upcoming.compactMap {
            switch $0 {
            case .booking(let b): b.createdAt
            case .signup(let s):  s.createdAt
            case .ticket(let t):  t.createdAt
            case .invite:         nil
            }
        }
        return stamps.compactMap(Self.parseISO).max()
    }

    private static func parseISO(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }

    /// All bookings the page currently knows about — used by the deep-link
    /// listener so a notification tap can match the right booking.
    var allBookings: [Booking] { data?.bookings ?? [] }

    /// Booking IDs we've just submitted a survey for during this session.
    /// Filtering on this gives an immediate UI dismiss without waiting for
    /// the next server fetch to reflect the new attendance status.
    private(set) var dismissedReviewIds: Set<UUID> = []

    func markReviewSubmitted(_ bookingId: UUID) {
        dismissedReviewIds.insert(bookingId)
    }

    /// Swipe-to-delete on a pending review — drops the card immediately and
    /// calls `DELETE /api/surveys?booking_id=…` to persist the dismissal so the
    /// booking won't reappear on next launch. The web survey endpoint already
    /// stores this on `bookings.survey_dismissed_at`.
    func dismissReview(_ bookingId: UUID, api: APIClient) {
        dismissedReviewIds.insert(bookingId)
        Task {
            struct Resp: Decodable, Sendable { let dismissed: String? }
            let path = "/api/surveys?booking_id=\(bookingId.uuidString.lowercased())"
            let _: Resp? = try? await api.delete(path)
        }
    }

    /// Bookings from yesterday to 7 days ago whose attendance status isn't yet
    /// resolved one way or the other. Mirrors `/api/surveys` web window.
    var pendingReviews: [Booking] {
        guard let data else { return [] }
        let cal = Calendar.current
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        guard let yesterday = cal.date(byAdding: .day, value: -1, to: Date()),
              let weekAgo   = cal.date(byAdding: .day, value: -7, to: Date()) else { return [] }
        let y = fmt.string(from: yesterday), w = fmt.string(from: weekAgo)
        let resolved: Set<String> = ["verified_attended","likely_attended","user_claimed_attended","no_show","disputed"]
        return data.bookings
            .filter { $0.status != "cancelled" }
            .filter { !resolved.contains($0.attendanceStatus ?? "") }
            .filter { !dismissedReviewIds.contains($0.id) }
            .filter { $0.bookingDate <= y && $0.bookingDate >= w }
            .sorted { $0.bookingDate > $1.bookingDate }
    }

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

/// Continuous horizontal progress of the Tickets/Reviews pager (0…1),
/// published every frame of the swipe via the content's minX.
private struct PagerProgressKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}


/// Identifiable wrapper so a saved event's token can drive a .sheet(item:).
private struct SavedToken: Identifiable {
    let value: String
    var id: String { value }
}
