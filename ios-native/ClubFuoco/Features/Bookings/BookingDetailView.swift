import SwiftUI

/// Full-screen detail for a single reservation, opened by tapping a ticket
/// card on the Tickets tab.
///
/// Laid out to the "Tickets · fullscreen QR" design: a full-bleed hero with
/// floating controls, the scannable QR on a card that overlaps it (the QR is
/// the point of this screen, so it sits above the fold), then the facts strip,
/// receipt, venue and manage sections.
struct BookingDetailView: View {
    let booking: Booking
    /// The group night this booking belongs to, if any.
    var group: GroupListItem? = nil
    /// Whether cancelling is still allowed (upcoming + not already cancelled).
    let canCancel: Bool
    /// Called after the user confirms cancellation in the inline popover; the
    /// parent dismisses this cover and performs the cancel.
    var onConfirmCancel: () -> Void = {}
    var onOpenGroup: (GroupListItem) -> Void = { _ in }
    /// Called when an attendance signal lands so the parent can refresh the
    /// booking and re-render the card in its new state.
    var onAttendanceChanged: () -> Void = {}

    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var calendarMessage: String?
    @State private var showHelp = false

    private var isCancelled: Bool { booking.status == "cancelled" }

    /// The supplier who created this guestlist (Rumba, Aashi, …). Their identity
    /// carries the whole reservation — accent colour + lockup — so it reads as
    /// the promoter's own pass, matching the branded offer sheet they booked in.
    private var brand: PartnerBrand? { booking.brand }
    private var accent: Color { brand.flatMap { Color(hexString: $0.color) } ?? Theme.ember }

    /// scan_token only: the CF- code does not open a door (see Booking.doorToken).
    private var qrToken: String? { booking.doorToken }

    /// What we PRINT is the same token the QR encodes. Showing the CF-
    /// reference under a scan_token QR invited staff to key in a code the door
    /// rejects — the two must agree.
    private var printedToken: String? { booking.doorToken }

    /// Full token, grouped in fours so it can be read aloud or typed at the
    /// door when a scan fails.
    private var printedTokenGrouped: String? {
        printedToken.map(TicketFormat.grouped)
    }

    /// Short handle for the header pill, where the full 32 characters won't fit.
    private var printedTokenShort: String? {
        printedToken.map { String($0.prefix(8)) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                // Negative top padding lifts the card over the hero without
                // leaving a gap under the last section (a plain .offset would).
                VStack(spacing: 26) {
                    if !isCancelled, let qrToken { qrCard(qrToken) }
                    statsStrip
                    if let brand { brandLockup(brand) }
                    if !isCancelled {
                        AttendanceCheckInCard(booking: booking,
                                              onSignalPosted: onAttendanceChanged)
                    }
                    receiptSection
                    whereSection
                    if let group { groupLink(group) }
                    manageSection
                    if let calendarMessage {
                        Text(calendarMessage)
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.fadedSand)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, isCancelled ? 24 : -46)
                .padding(.bottom, 40)
            }
        }
        .background(Theme.cream)
        .ignoresSafeArea(edges: .top)
        .toolbar(.hidden, for: .navigationBar)
        // This is pushed now rather than presented as a cover, so the tab bar
        // would otherwise sit under the ticket. Hidden here keeps the
        // full-bleed look the cover gave it, with the back swipe on top.
        .toolbar(.hidden, for: .tabBar)
        // ...and hiding the navigation bar above is exactly what switches the
        // back-swipe off, so put it back.
        .interactivePopEnabled()
        .sheet(isPresented: $showHelp) { BookingHelpSheet(booking: booking) }
        .task { await firePassViewedIfAppropriate() }
    }


    /// Fire a passive `pass_viewed` signal so confidence can climb without the
    /// user needing to tap. Silent: we never prompt for location here — only
    /// piggy-back on an existing grant.
    private func firePassViewedIfAppropriate() async {
        guard !isCancelled,
              LocationService.shared.authorizationStatus == .authorizedWhenInUse
                || LocationService.shared.authorizationStatus == .authorizedAlways
        else { return }
        guard let loc = try? await LocationService.shared.currentLocation() else { return }

        struct Body: Encodable { let kind: String; let lat: Double; let lng: Double }
        struct Resp: Decodable, Sendable { let logged: String? }
        let body = Body(kind: "pass_viewed", lat: loc.coordinate.latitude, lng: loc.coordinate.longitude)
        let _: Resp? = try? await api.post(
            "/api/bookings/\(booking.id.uuidString.lowercased())/signals", body: body
        )
    }

    // ── Hero ──────────────────────────────────────────────────────────────────

    private var data: TicketCardData { TicketCardData(booking: booking) }

    private var hero: some View {
        TicketHero(
            data: data,
            accent: accent,
            attribution: brand?.attributionLabel,
            codeLabel: printedTokenShort.map {
                "\(locale.t("bookings.factTicket").uppercased()) · \($0)"
            },
            onBack: { dismiss() },
            onHelp: { showHelp = true }
        )
    }

    private func qrCard(_ token: String) -> some View {
        TicketQRCard(token: token, printed: printedTokenGrouped)
    }

    private var statsStrip: some View { TicketStatsStrip(data: data) }

    private func circleButton(_ system: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Image(systemName: system)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(.black.opacity(0.34), in: .circle)
                .overlay(Circle().stroke(.white.opacity(0.16)))
        }
        .buttonStyle(.plain)
    }

    // ── Receipt ───────────────────────────────────────────────────────────────
    // Only for bookings that actually cost something — a free guestlist entry
    // has no receipt to show.

    @ViewBuilder private var receiptSection: some View {
        if let total = booking.totalAmount, total > 0 {
            section(locale.t("bookings.receipt")) {
                VStack(spacing: 0) {
                    receiptRow("\(ticketTypeLabel) × \(booking.partySize)", money(total))
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    receiptRow(locale.t("bookings.serviceFee"), locale.t("bookings.included"))
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    receiptRow(locale.t("bookings.totalPaid"), money(total), emphasised: true)
                }
            }
        }
    }

    private func receiptRow(_ label: String, _ value: String, emphasised: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(emphasised ? .cfSerif(19) : .cfSans(14))
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 12)
            Text(value)
                .font(emphasised ? .cfSerif(19) : .cfSans(14))
                .foregroundStyle(emphasised ? Theme.ink : Theme.stone)
        }
        .padding(.vertical, emphasised ? 14 : 12)
    }

    // ── Where ─────────────────────────────────────────────────────────────────

    @ViewBuilder private var whereSection: some View {
        if let club = booking.club {
            section(locale.t("bookings.where")) {
                HStack(alignment: .top, spacing: 14) {
                    Group {
                        if let url = club.coverImageUrl.flatMap(URL.init(string:)) {
                            CachedAsyncImage(url: url, targetWidth: 140) {
                                $0.resizable().aspectRatio(contentMode: .fill)
                            } placeholder: { Theme.imagePlaceholder }
                        } else {
                            Theme.imagePlaceholder
                        }
                    }
                    .frame(width: 68, height: 68)
                    .clipShape(.rect(cornerRadius: 12))
                    // Taps only inside the visible frame — a .fill image's clipped-away overflow
                    // still hit-tests and steals taps from views above it on wider phones.
                    .contentShape(.rect(cornerRadius: 12))

                    VStack(alignment: .leading, spacing: 4) {
                        Text(club.name)
                            .font(.cfSerif(21))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(2)
                        if let neighborhood = club.neighborhood, !neighborhood.isEmpty {
                            Text(neighborhood.uppercased())
                                .font(.cfMono(9)).kerning(1.2)
                                .foregroundStyle(Theme.fadedSand)
                        }
                        if let address = club.address, !address.isEmpty {
                            Text(address)
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.stone)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 4)
            }
        }
    }

    // ── Manage ────────────────────────────────────────────────────────────────

    private var manageSection: some View {
        section(locale.t("bookings.manage")) {
            VStack(spacing: 10) {
                if !isCancelled {
                    manageButton("calendar.badge.plus", locale.t("groups.addToCalendar")) {
                        Haptics.tap(); addToCalendar()
                    }
                    WalletPassButton(passPath: "/api/bookings/\(booking.id.uuidString.lowercased())/wallet",
                                     fullWidth: true)
                    ShareLink(item: shareText) {
                        manageLabel("square.and.arrow.up", locale.t("bookings.shareTicket"))
                    }
                    .buttonStyle(.plain)
                }
                if canCancel {
                    CancelConfirmButton {
                        onConfirmCancel()
                    } label: {
                        Text(locale.t("common.cancel"))
                            .font(.cfSans(14, weight: .medium))
                            .foregroundStyle(Theme.wine)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.wine.opacity(0.3)))
                    }
                }
            }
            .padding(.top, 4)
        }
    }

    private func manageButton(_ icon: String, _ title: String,
                              _ run: @escaping () -> Void) -> some View {
        Button(action: run) { manageLabel(icon, title) }
            .buttonStyle(.plain)
    }

    private func manageLabel(_ icon: String, _ title: String) -> some View {
        // Centred, not leading: the Wallet button in this stack is a system
        // control that centres its own content, so a leading Spacer here left
        // every other row hanging off-axis beside it.
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 14))
            Text(title).font(.cfSans(14, weight: .medium))
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 16)
        .frame(height: 48)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
    }

    /// Venue and night only — deliberately no token. The printed code is now the
    /// door secret, and sharing it would hand someone else the entry.
    private var shareText: String {
        [booking.club?.name, dateLabel]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    // ── Shared bits ───────────────────────────────────────────────────────────

    /// Section header in the design's idiom: a small wine kicker over content.
    private func section<Content: View>(_ title: String,
                                        @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.cfMono(9)).kerning(1.5)
                .foregroundStyle(Theme.wine)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func groupLink(_ group: GroupListItem) -> some View {
        Button {
            Haptics.tap()
            onOpenGroup(group)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 13))
                Text(locale.t("bookings.seeWhosGoing"))
                    .font(.cfSans(14, weight: .medium))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.fadedSand)
            }
            .foregroundStyle(Theme.ink)
            .padding(16)
            .background(Theme.surface, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
        }
        .buttonStyle(.plain)
    }

    /// Supplier lockup carrying the whole page's identity — big mark in the
    /// brand's accent on a soft tint of it. Rumba renders its signature pink
    /// gloss wordmark; other suppliers (Aashi) render their logo in-accent.
    private func brandLockup(_ brand: PartnerBrand) -> some View {
        VStack(spacing: 10) {
            Text(locale.t("bookings.factGuestlist").uppercased())
                .font(.cfMono(9)).kerning(1.6)
                .foregroundStyle(accent.opacity(0.85))
            SupplierMark(brand: brand, height: 26, tint: accent)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .background(accent.opacity(0.08), in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(accent.opacity(0.28)))
    }

    private func addToCalendar() {
        Task {
            do {
                try await CalendarService.addNightEvent(
                    title: String(format: locale.t("groups.calendarTitle"), booking.club?.name ?? ""),
                    dateString: booking.bookingDate,
                    location: booking.club?.address ?? booking.club?.name,
                    notes: locale.t("groups.calendarNotes")
                )
                Haptics.success()
                calendarMessage = locale.t("groups.calendarAdded")
            } catch {
                Haptics.error()
                calendarMessage = locale.t("groups.calendarError")
            }
        }
    }

    // ── Formatting ────────────────────────────────────────────────────────────

    private var ticketTypeLabel: String {
        locale.t(booking.bookingType == "vip" ? "bookings.vip" : "bookings.general")
    }

    /// Doors time — the arrival window when the booking carries one, else the
    /// house default the facts list has always shown.
    private var doorsLabel: String {
        if let arrival = booking.arrivalWindow, !arrival.isEmpty { return arrival }
        return "23:00"
    }

    private func money(_ value: Double) -> String {
        // Whole euros read cleaner on a receipt; keep cents when there are any.
        value == value.rounded()
            ? "€\(Int(value))"
            : "€\(String(format: "%.2f", value))"
    }

    /// "Tonight" on the night itself, otherwise a short date.
    private var dateLabel: String { TicketFormat.dateLabel(booking.bookingDate, locale: locale) }
}
