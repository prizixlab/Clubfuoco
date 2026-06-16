import SwiftUI
import Observation

/// Lightweight Identifiable wrapper so a group id can drive `.sheet(item:)`.
struct GroupRef: Identifiable {
    let id: UUID
}

/// Native port of the group night detail: hero, members with RSVP/paid
/// states, my RSVP actions (join free / maybe / decline), organizer tools
/// (invite friends, remind, share invite link, call off the night).
/// Paid joins need the in-app payment flow (later this phase) — the join
/// button explains that instead of dead-ending on the 402.
struct GroupDetailView: View {
    let groupId: UUID
    /// Set when presented as a sheet (vs pushed onto a nav stack) so we can
    /// offer an explicit Done button — the scrolling content otherwise eats the
    /// swipe-to-dismiss gesture.
    var presentedModally = false
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var model = GroupDetailViewModel()
    @State private var confirmCancel = false
    @State private var showInvite = false
    @State private var showPaymentNote = false
    @State private var showQR = false
    @State private var calendarMessage: String?

    var body: some View {
        Group {
            if model.loading {
                ProgressView(locale.t("common.loading"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let group = model.group {
                content(group)
            } else {
                Text(model.errorMessage ?? locale.t("groups.notFound"))
                    .font(.cfSans(14))
                    .foregroundStyle(Theme.wine)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.cream)
        .task { await model.load(groupId, api: api, queries: auth.queries) }
        .alert(locale.t("groups.paymentNeeded"), isPresented: $showPaymentNote) {
            Button(locale.t("common.done"), role: .cancel) {}
        }
        .alert(calendarMessage ?? "", isPresented: Binding(get: { calendarMessage != nil }, set: { if !$0 { calendarMessage = nil } })) {
            Button(locale.t("common.done"), role: .cancel) {}
        }
        .sheet(isPresented: $showInvite) {
            inviteSheet
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showQR) {
            if let group = model.group, let token = passToken {
                qrSheet(clubName: group.clubName, date: group.bookingDate, token: token)
            }
        }
        .toolbar {
            if presentedModally {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(locale.t("common.done")) { dismiss() }
                        .font(.cfSans(15, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
            }
        }
    }

    private func content(_ group: GroupDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Hero
                ZStack(alignment: .bottomLeading) {
                    Color(hex: 0xEFE9DD)
                        .overlay {
                            if let url = group.clubImage.flatMap(URL.init(string:)) {
                                CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0xEFE9DD) }
                            }
                        }
                        .frame(height: 200)
                        .clipped()
                    LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .bottom, endPoint: .top)
                    VStack(alignment: .leading, spacing: 4) {
                        statusChip(group.status)
                        Text(group.clubName)
                            .font(.cfSerif(32))
                            .foregroundStyle(.white)
                        Text("\(formatDate(group.bookingDate)) · \(locale.t(group.bookingType == "vip" ? "bookings.vip" : "bookings.general"))")
                            .font(.cfSans(13))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(16)
                }
                .clipShape(.rect(cornerRadius: Theme.radiusCard))
                .padding(.horizontal, 20)

                // Your pass (going members) or RSVP actions
                if group.me?.rsvp == "going", group.status != "cancelled" {
                    passSection(group)
                        .padding(.horizontal, 20)
                } else if group.status == "open" {
                    rsvpBar(group)
                        .padding(.horizontal, 20)
                }

                if let error = model.errorMessage {
                    FormError(message: error)
                        .padding(.horizontal, 20)
                }

                // Members
                VStack(alignment: .leading, spacing: 8) {
                    Kicker(String(format: locale.t("groups.going"), group.members.filter { $0.rsvp == "going" }.count), color: Theme.fadedSand)
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(group.members) { member in
                        memberRow(member)
                    }
                }
                .padding(.horizontal, 20)

                // Organizer tools
                if group.me?.role == "organizer" {
                    organizerTools(group)
                        .padding(.horizontal, 20)
                }
            }
            .padding(.vertical, 16)
        }
        .refreshable { await model.load(groupId, api: api, queries: auth.queries) }
    }

    // ── Your pass ─────────────────────────────────────────────────────────────

    /// The viewer's own pass token. Each member's group entry is a separately
    /// generated booking, so this binds to *my* booking specifically — prefer
    /// the id the API now returns, falling back to the club+date match.
    private var passToken: String? {
        model.group?.me?.qrToken ?? model.myBooking?.qrCodeToken
    }

    private var passBookingId: UUID? {
        model.group?.me?.bookingId ?? model.myBooking?.id
    }

    /// The "same booking stuff" for a group night: a ticket-style pass with the
    /// member's QR (their group entry is a real booking), Show-QR / Wallet
    /// actions, plus an Add-to-calendar button.
    private func passSection(_ group: GroupDetail) -> some View {
        VStack(spacing: 12) {
            passCard(group)
            addToCalendarButton(group)
        }
    }

    private func passCard(_ group: GroupDetail) -> some View {
        let goingCount = group.members.filter { $0.rsvp == "going" }.count

        return VStack(spacing: 0) {
            // Header strip — your confirmed spot
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color(hex: 0x2D7A46))
                Text(locale.t("groups.yourPass"))
                    .font(.cfSans(14, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                if group.me?.paid == true {
                    tag(locale.t("groups.paid"))
                }
                Spacer()
            }
            .padding(14)

            TicketPerforation()

            VStack(spacing: 14) {
                HStack(spacing: 8) {
                    factCell(locale.t("bookings.factDate"), shortDate(group.bookingDate))
                    factCell(locale.t("bookings.factDoors"), "23:00")
                    factCell(locale.t("bookings.factGuests"), "\(goingCount)")
                    factCell(locale.t("bookings.factTicket"),
                             locale.t(group.bookingType == "vip" ? "bookings.vip" : "bookings.general"))
                }

                if let token = passToken, let bookingId = passBookingId {
                    HStack(spacing: 12) {
                        Button {
                            Haptics.tap()
                            showQR = true
                        } label: {
                            QRCodeView(token: token)
                                .frame(width: 46, height: 46)
                        }
                        Text(locale.t("bookings.atDoor"))
                            .font(.cfSans(12))
                            .foregroundStyle(Theme.stone)
                        Spacer()
                        Button {
                            Haptics.tap()
                            showQR = true
                        } label: {
                            Text(locale.t("bookings.showQR"))
                                .font(.cfSans(12, weight: .semibold))
                                .foregroundStyle(Theme.cream)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(Theme.ink, in: .capsule)
                        }
                    }

                    HStack {
                        // Each member's pass is its own booking → its own wallet pass.
                        WalletPassButton(
                            passPath: "/api/bookings/\(bookingId.uuidString.lowercased())/wallet",
                            compact: true
                        )
                        Spacer()
                    }
                }
            }
            .padding(16)
        }
        .background(Color.white)
        .clipShape(.rect(cornerRadius: 16))
        .shadow(color: Color(hex: 0x221E1A).opacity(0.08), radius: 8, y: 2)
    }

    private func addToCalendarButton(_ group: GroupDetail) -> some View {
        Button {
            Haptics.tap()
            Task {
                do {
                    try await CalendarService.addNightEvent(
                        title: String(format: locale.t("groups.calendarTitle"), group.clubName),
                        dateString: group.bookingDate,
                        location: group.clubName,
                        notes: locale.t("groups.calendarNotes")
                    )
                    Haptics.success()
                    calendarMessage = locale.t("groups.calendarAdded")
                } catch {
                    Haptics.error()
                    calendarMessage = locale.t("groups.calendarError")
                }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "calendar.badge.plus")
                    .font(.system(size: 13))
                Text(locale.t("groups.addToCalendar"))
                    .font(.cfSans(13, weight: .medium))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
            .foregroundStyle(Theme.ink)
        }
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

    private func qrSheet(clubName: String, date: String, token: String) -> some View {
        VStack(spacing: 20) {
            Kicker("CLUB FUOCO · \(clubName)")
                .padding(.top, 32)

            Text(formatDate(date))
                .font(.cfSerif(28))
                .foregroundStyle(Theme.ink)

            QRCodeView(token: token)
                .frame(width: 260, height: 260)
                .padding(20)
                .background(Color.white, in: .rect(cornerRadius: 20))

            Text(locale.t("bookings.atDoor"))
                .font(.cfSerif(16, italic: true))
                .foregroundStyle(Theme.stone)

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(Theme.cream)
        .presentationDetents([.large])
    }

    // ── RSVP bar ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private func rsvpBar(_ group: GroupDetail) -> some View {
        let me = group.me
        let charge = me?.charge ?? group.unitPrice
        let alreadyGoing = me?.rsvp == "going" && me?.paid != false

        if !alreadyGoing {
            HStack(spacing: 10) {
                Button {
                    Haptics.tap()
                    if charge > 0 {
                        if ApplePayService.isAvailable {
                            model.payAndJoin(charge: charge, clubName: group.clubName, api: api)
                        } else {
                            showPaymentNote = true
                        }
                    } else {
                        model.rsvp("join", api: api)
                    }
                } label: {
                    Text(charge > 0
                         ? String(format: locale.t("groups.joinFor"), "€\(String(format: "%.2f", charge))")
                         : locale.t("groups.join"))
                        .font(.cfSans(14, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(Theme.wine, in: .rect(cornerRadius: 12))
                        .foregroundStyle(Theme.cream)
                }

                Button {
                    model.rsvp("maybe", api: api)
                } label: {
                    Text(locale.t("groups.maybe"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 16)
                        .frame(height: 48)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                }

                Button {
                    model.rsvp("decline", api: api)
                } label: {
                    Text(locale.t("friends.decline"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.stone)
                        .padding(.horizontal, 16)
                        .frame(height: 48)
                }
            }
            .disabled(model.busy)
            .opacity(model.busy ? 0.6 : 1)
        }
    }

    // ── Members ───────────────────────────────────────────────────────────────

    private func memberRow(_ member: GroupMember) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Theme.wine.opacity(0.08))
                .frame(width: 40, height: 40)
                .overlay {
                    if let avatar = member.avatarUrl, let url = URL(string: avatar) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color.clear }
                            .clipShape(.circle)
                    } else {
                        Text(member.initials)
                            .font(.cfSerif(15, italic: true))
                            .foregroundStyle(Theme.wine)
                    }
                }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(member.fullName ?? locale.t("profile.member"))
                        .font(.cfSerif(17))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if member.role == "organizer" {
                        Kicker(locale.t("groups.organizer"), color: Theme.gold, size: 8)
                    }
                }
                if member.charge > 0 {
                    Text("€\(String(format: "%.2f", member.charge))")
                        .font(.cfSans(11))
                        .foregroundStyle(Theme.fadedSand)
                }
            }

            Spacer()

            if member.paid {
                tag(locale.t("groups.paid"))
            } else {
                rsvpTag(member.rsvp)
            }
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private func rsvpTag(_ rsvp: String) -> some View {
        switch rsvp {
        case "going":
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Color(hex: 0x2D7A46))
        case "maybe":
            tag(locale.t("groups.maybe"))
        case "declined":
            tag(locale.t("groups.declined"))
        default:
            tag(locale.t("groups.invited"))
        }
    }

    // ── Organizer tools ───────────────────────────────────────────────────────

    private func organizerTools(_ group: GroupDetail) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                toolButton(locale.t("groups.inviteFriends"), icon: "person.badge.plus") {
                    showInvite = true
                    model.loadFriends(api: api, excluding: Set(group.members.map(\.userId)))
                }
                toolButton(model.remindMessage ?? locale.t("groups.remind"), icon: "bell") {
                    model.remind(api: api, locale: locale)
                }
            }

            ShareLink(
                item: URL(string: "https://clubfuoco.com/join/\(group.inviteCode)")!,
                message: Text(String(format: locale.t("groups.shareText"), group.clubName, formatDate(group.bookingDate)))
            ) {
                HStack(spacing: 8) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 13))
                    Text("\(locale.t("groups.share")) · \(group.inviteCode)")
                        .font(.cfSans(13, weight: .medium))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .background(Theme.ink, in: .rect(cornerRadius: 12))
                .foregroundStyle(Theme.cream)
            }

            if group.status == "open" {
                Button(role: .destructive) {
                    Haptics.tap()
                    confirmCancel = true
                } label: {
                    Text(locale.t("groups.cancelNight"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.wine)
                        .padding(.vertical, 10)
                }
                .popover(isPresented: $confirmCancel) {
                    VStack(spacing: 0) {
                        Text(locale.t("groups.cancelConfirm"))
                            .font(.cfSans(13, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 14)
                        Divider()
                        Button {
                            // Dismiss first; the cancel closes the group and removes
                            // this button, so acting while the popover is up orphans
                            // its anchor and leaves a ghost.
                            confirmCancel = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { model.cancelNight(api: api) }
                        } label: {
                            Text(locale.t("groups.cancelNight"))
                                .font(.cfSans(14, weight: .semibold))
                                .foregroundStyle(Theme.wine)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                        Divider()
                        Button { confirmCancel = false } label: {
                            Text(locale.t("bookings.keep"))
                                .font(.cfSans(14))
                                .foregroundStyle(Theme.stone)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                    }
                    .frame(width: 250)
                    .presentationCompactAdaptation(.popover)
                }
            }
        }
    }

    private func toolButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 13))
                Text(title)
                    .font(.cfSans(13, weight: .medium))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
            .foregroundStyle(Theme.ink)
        }
        .disabled(model.busy)
    }

    private var inviteSheet: some View {
        NavigationStack {
            List {
                ForEach(model.invitableFriends) { friend in
                    Button {
                        model.toggleInvite(friend.id)
                    } label: {
                        HStack {
                            Text(friend.fullName ?? locale.t("profile.member"))
                                .font(.cfSerif(17))
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Image(systemName: model.inviteSelection.contains(friend.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(model.inviteSelection.contains(friend.id) ? Theme.wine : Theme.fadedSand)
                        }
                    }
                }
            }
            .navigationTitle(locale.t("groups.inviteFriends"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(locale.t("groups.invite")) {
                        model.invite(api: api)
                        showInvite = false
                    }
                    .disabled(model.inviteSelection.isEmpty)
                }
            }
        }
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(.cfSans(10, weight: .semibold))
            .foregroundStyle(Theme.fadedSand)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(Color(hex: 0x221E1A).opacity(0.05), in: .capsule)
    }

    private func statusChip(_ status: String) -> some View {
        let (key, color): (String, Color) = switch status {
        case "open": ("groups.statusOpen", Color(hex: 0x2D7A46))
        case "closed": ("groups.statusClosed", Theme.gold)
        default: ("groups.statusCancelled", Theme.wine)
        }
        return Text(locale.t(key).uppercased())
            .font(.cfSans(8.5, weight: .semibold))
            .kerning(1)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color, in: .capsule)
    }

    private func formatDate(_ value: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        formatter.setLocalizedDateFormatFromTemplate("EEEE d MMMM")
        return formatter.string(from: date)
    }
}

// ── View model ────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class GroupDetailViewModel {
    private(set) var group: GroupDetail?
    /// The viewer's own group entry as a real booking (carries the QR token /
    /// wallet pass). Matched from their bookings by club + date.
    private(set) var myBooking: Booking?
    private(set) var loading = true
    private(set) var busy = false
    var errorMessage: String?
    var remindMessage: String?

    private(set) var invitableFriends: [FriendUser] = []
    private(set) var inviteSelection: Set<UUID> = []
    private var groupId: UUID?
    private var queries: Queries?

    func load(_ id: UUID, api: APIClient, queries: Queries) async {
        groupId = id
        self.queries = queries
        errorMessage = nil
        do {
            group = try await api.get("/api/groups/\(id.uuidString.lowercased())")
            await loadMyBooking(queries: queries)
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    /// Re-runs the full load after a mutation, reusing the stored queries.
    private func refresh(api: APIClient) async {
        guard let groupId, let queries else { return }
        await load(groupId, api: api, queries: queries)
    }

    /// Find the booking backing my "going" spot (each group join creates one).
    private func loadMyBooking(queries: Queries) async {
        guard let group, group.me?.rsvp == "going" else {
            myBooking = nil
            return
        }
        guard let bookings = try? await queries.myBookings().bookings else { return }
        myBooking = bookings.first {
            $0.club?.id == group.clubId
                && $0.bookingDate == group.bookingDate
                && $0.status != "cancelled"
        }
    }

    func rsvp(_ action: String, api: APIClient) {
        guard let groupId else { return }
        busy = true
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable { let action: String }
                let _: GroupJoinResult = try await api.post(
                    "/api/groups/\(groupId.uuidString.lowercased())/join",
                    body: Body(action: action)
                )
                Haptics.success()
            } catch {
                errorMessage = error.localizedDescription
            }
            await refresh(api: api)
            busy = false
        }
    }

    /// Paid join: Apple Pay sheet → Stripe PaymentMethod → join with
    /// payment_method_id (the server charges this member's resolved share).
    func payAndJoin(charge: Double, clubName: String, api: APIClient) {
        guard let groupId else { return }
        busy = true
        errorMessage = nil
        Task {
            do {
                try await ApplePayService.pay(amount: charge, label: clubName) { paymentMethodId in
                    struct Body: Encodable {
                        let action: String
                        let paymentMethodId: String
                    }
                    let _: GroupJoinResult = try await api.post(
                        "/api/groups/\(groupId.uuidString.lowercased())/join",
                        body: Body(action: "join", paymentMethodId: paymentMethodId)
                    )
                }
                Haptics.success()
            } catch let error as ApplePayError where error == .cancelled {
                // User closed the Apple Pay sheet
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            await refresh(api: api)
            busy = false
        }
    }

    func cancelNight(api: APIClient) {
        guard let groupId else { return }
        busy = true
        Task {
            do {
                struct Body: Encodable { let status: String }
                struct Result: Decodable, Sendable { let status: String }
                let _: Result = try await api.patch(
                    "/api/groups/\(groupId.uuidString.lowercased())",
                    body: Body(status: "cancelled")
                )
            } catch {
                errorMessage = error.localizedDescription
            }
            await refresh(api: api)
            busy = false
        }
    }

    func remind(api: APIClient, locale: LocaleStore) {
        guard let groupId else { return }
        busy = true
        Task {
            do {
                struct Result: Decodable, Sendable { let reminded: Int }
                let result: Result = try await api.post("/api/groups/\(groupId.uuidString.lowercased())/remind")
                remindMessage = result.reminded > 0
                    ? String(format: locale.t("groups.reminded"), result.reminded)
                    : locale.t("groups.everyoneResponded")
                try? await Task.sleep(for: .seconds(2.5))
                remindMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    func loadFriends(api: APIClient, excluding memberIds: Set<UUID>) {
        Task {
            if let data: FriendsData = try? await api.get("/api/friends") {
                invitableFriends = data.friends.filter { !memberIds.contains($0.id) }
                inviteSelection = []
            }
        }
    }

    func toggleInvite(_ id: UUID) {
        if inviteSelection.contains(id) { inviteSelection.remove(id) } else { inviteSelection.insert(id) }
    }

    func invite(api: APIClient) {
        guard let groupId, !inviteSelection.isEmpty else { return }
        busy = true
        Task {
            do {
                struct Body: Encodable { let userIds: [String] }
                struct Result: Decodable, Sendable { let invited: Int? }
                let _: Result = try await api.post(
                    "/api/groups/\(groupId.uuidString.lowercased())/invite",
                    body: Body(userIds: inviteSelection.map { $0.uuidString.lowercased() })
                )
                Haptics.success()
            } catch {
                errorMessage = error.localizedDescription
            }
            await refresh(api: api)
            busy = false
        }
    }
}
