import SwiftUI

/// Full-screen detail for a single reservation, opened by tapping a ticket
/// card on the Tickets tab. Shows the venue hero, every booking fact, the
/// scannable QR + reference, and the Wallet / Calendar / Cancel actions.
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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    hero
                    if let brand { brandLockup(brand) }
                    facts
                    if !isCancelled {
                        AttendanceCheckInCard(booking: booking,
                                              onSignalPosted: onAttendanceChanged)
                    }
                    if !isCancelled, let token = (booking.scanToken ?? booking.qrCodeToken) {
                        qrBlock(token)
                        actions
                    }
                    if let group {
                        groupLink(group)
                    }
                    if let calendarMessage {
                        Text(calendarMessage)
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.fadedSand)
                    }
                    if canCancel {
                        CancelConfirmButton {
                            onConfirmCancel()
                        } label: {
                            Text(locale.t("common.cancel"))
                                .font(.cfSans(14, weight: .medium))
                                .foregroundStyle(Theme.wine)
                                .frame(maxWidth: .infinity)
                                .frame(height: 46)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.wine.opacity(0.3)))
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.cream)
            .navigationTitle(locale.t("bookings.detailTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showHelp = true } label: {
                        Label(locale.t("help.button"), systemImage: "questionmark.circle")
                            .font(.cfSans(14, weight: .medium))
                    }
                    .tint(Theme.wine)
                }
            }
            .sheet(isPresented: $showHelp) { BookingHelpSheet(booking: booking) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.stone)
                    }
                }
            }
            .task { await firePassViewedIfAppropriate() }
        }
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

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            Color(hex: 0x2A1F1A)
                .overlay {
                    if let url = booking.club?.coverImageUrl.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0x2A1F1A) }
                    }
                }
                .frame(height: 200)
                .clipped()
                .overlay(
                    LinearGradient(colors: [.black.opacity(0.1), .black.opacity(0.7)],
                                   startPoint: .top, endPoint: .bottom)
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(locale.t("bookings.nightlife"))
                        .font(.cfSans(10))
                        .foregroundStyle(.white.opacity(0.85))
                    Spacer()
                    statusBadge
                }
                Spacer()
                Text(booking.club?.name ?? "—")
                    .font(.cfSerif(26, italic: true))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text(longDate(booking.bookingDate))
                    .font(.cfSans(12))
                    .foregroundStyle(.white.opacity(0.75))
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: 200, alignment: .bottomLeading)
        }
        .frame(height: 200)
        .clipShape(.rect(cornerRadius: 16))
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

    private var statusBadge: some View {
        let (key, color): (String, Color) = switch booking.status {
        case "cancelled": ("bookings.statusCancelled", Color(hex: 0x888888))
        case "pending":   ("bookings.statusPending", Theme.gold)
        default:          ("bookings.statusConfirmed", accent)
        }
        return Text(locale.t(key).uppercased())
            .font(.cfSans(9, weight: .semibold))
            .kerning(0.8)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(.black.opacity(0.3), in: .capsule)
            .overlay(Capsule().stroke(color.opacity(0.3)))
    }

    // ── Facts ─────────────────────────────────────────────────────────────────

    private var facts: some View {
        VStack(spacing: 0) {
            factRow(locale.t("bookings.factDate")) { Text(longDate(booking.bookingDate)) }
            divider
            factRow(locale.t("bookings.factDoors")) { Text("23:00") }
            if let arrival = booking.arrivalWindow, !arrival.isEmpty {
                divider
                factRow(locale.t("bookings.factArrival")) { Text(arrival) }
            }
            divider
            factRow(locale.t("bookings.factGuests")) { Text("\(booking.partySize)") }
            divider
            factRow(locale.t("bookings.factTicket")) {
                Text(locale.t(booking.bookingType == "vip" ? "bookings.vip" : "bookings.general"))
            }
            if let address = booking.club?.address, !address.isEmpty {
                divider
                factRow(locale.t("rumbalist.address"), small: true) {
                    Text(address).foregroundStyle(Theme.stone)
                }
            }
            divider
            factRow(locale.t("bookings.factStatus")) {
                Text(locale.t(statusKey))
            }
            if let total = booking.totalAmount, total > 0 {
                divider
                factRow(locale.t("rumbalist.total"), bold: true) {
                    Text("€\(String(format: "%.2f", total))")
                }
            }
        }
        .padding(.init(top: 6, leading: 16, bottom: 6, trailing: 16))
        .background(Color.white, in: .rect(cornerRadius: 14))
        .shadow(color: Color(hex: 0x221E1A).opacity(0.05), radius: 8, y: 2)
    }

    private var statusKey: String {
        switch booking.status {
        case "cancelled": "bookings.statusCancelled"
        case "pending":   "bookings.statusPending"
        default:          "bookings.statusConfirmed"
        }
    }

    private func factRow(_ label: String, small: Bool = false, bold: Bool = false, @ViewBuilder value: () -> some View) -> some View {
        HStack(alignment: .top) {
            Text(label.uppercased())
                .font(.cfMono(9))
                .kerning(0.8)
                .foregroundStyle(Theme.fadedSand)
            Spacer(minLength: 16)
            value()
                .font(.cfSans(small ? 12 : 14, weight: bold ? .bold : .semibold))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 10)
    }

    private var divider: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }

    // ── QR + actions ───────────────────────────────────────────────────────────

    private func qrBlock(_ token: String) -> some View {
        VStack(spacing: 12) {
            Text(token)
                .font(.cfMono(12))
                .kerning(1)
                .foregroundStyle(accent.opacity(0.9))
            QRCodeView(token: token)
                .frame(width: 220, height: 220)
                .padding(18)
                .background(Color.white, in: .rect(cornerRadius: 18))
                .shadow(color: Color(hex: 0x221E1A).opacity(0.06), radius: 10, y: 4)
            Text(locale.t("bookings.atDoor"))
                .font(.cfSerif(15, italic: true))
                .foregroundStyle(Theme.fadedSand)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var actions: some View {
        VStack(spacing: 10) {
            WalletPassButton(passPath: "/api/bookings/\(booking.id.uuidString.lowercased())/wallet",
                             fullWidth: true)
            Button {
                Haptics.tap()
                addToCalendar()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 14))
                    Text(locale.t("groups.addToCalendar"))
                        .font(.cfSans(14, weight: .medium))
                }
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .background(Color.white, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
            }
        }
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
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
        }
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

    private func longDate(_ value: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        formatter.setLocalizedDateFormatFromTemplate("EEEE d MMM")
        return formatter.string(from: date)
    }
}
