import SwiftUI

/// The ticket on the Tickets tab, built to the "Ticket Card.html" artboard.
///
/// One card serves two things deliberately: an event reservation and a plain
/// venue booking. They share the hero, the perforation and the fact strip so
/// they read as one family; what differs is what the hero says. An event leads
/// with its OWN name and puts the venue underneath ("at Razzmatazz"), because
/// the guest chose the night, not the room. A venue booking leads with the
/// venue and puts its neighbourhood in the kicker.
///
/// Event detail comes from `booking.event`, populated by the embedded
/// `promoter_nights` row. Every field of it is optional — most bookings are not
/// events — so each part is dropped rather than faked when absent.
struct TicketCard: View {
    let booking: Booking
    /// The friends' group this night belongs to, when it is one.
    let group: GroupListItem?
    /// Only the next ticket up carries the Wallet button, per the artboard —
    /// on every card it becomes wallpaper.
    let showWallet: Bool
    let onShowQR: () -> Void
    let onOpenGroup: () -> Void

    @Environment(LocaleStore.self) private var locale

    private var isCancelled: Bool { booking.status == "cancelled" }
    private var isCheckedIn: Bool { booking.checkedInAt != nil || booking.status == "used" }
    private var isTonight: Bool { Self.isToday(booking.bookingDate) }
    private var event: BookingEvent? { booking.event }

    /// Title/subtitle swap: the event's name leads when there is one.
    private var headline: String {
        event?.title ?? booking.club?.name ?? "—"
    }
    private var underline: String? {
        if event?.title != nil, let venue = booking.club?.name {
            return String(format: locale.t("bookings.atVenue"), venue)
        }
        return booking.club?.neighborhood ?? booking.club?.address
    }
    /// Hosts for an event, neighbourhood for a venue booking.
    private var kicker: String? {
        event?.hostLine ?? booking.club?.neighborhood ?? locale.t("bookings.nightlife")
    }

    var body: some View {
        VStack(spacing: 0) {
            hero
            TicketPerforation()
            stub
        }
        .background(Explore.surface)
        .clipShape(.rect(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(borderColour, lineWidth: 1)
        )
        .opacity(isCancelled ? 0.62 : 1)
    }

    /// Ember outline for tonight, a warm one for the next ticket up, hairline
    /// otherwise — so the card that matters is findable without reading it.
    private var borderColour: Color {
        if isCancelled { return Explore.line }
        if isTonight { return Explore.ember.opacity(0.42) }
        if showWallet { return Explore.accentDim }
        return Explore.line
    }

    // ── Hero ──────────────────────────────────────────────────────────────────

    private var hero: some View {
        ZStack {
            Explore.surface2
                .overlay {
                    if let url = booking.club?.coverImageUrl.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                            placeholder: { Explore.surface2 }
                    }
                }
                .overlay { GrainOverlay().opacity(0.55) }
                .overlay(
                    LinearGradient(
                        stops: [
                            .init(color: Color(hex: 0x060504).opacity(0.5), location: 0),
                            .init(color: Color(hex: 0x060504).opacity(0.05), location: 0.42),
                            .init(color: Color(hex: 0x060504).opacity(0.82), location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .frame(height: 140)
                .clipped()

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 10) {
                    if let kicker {
                        Text(kicker.uppercased())
                            .font(.cfMono(8.5)).kerning(1.4)
                            .foregroundStyle(Color(hex: 0xF6EEDD).opacity(0.94))
                            .lineLimit(1)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(.ultraThinMaterial, in: .capsule)
                            .overlay(Capsule().stroke(Color(hex: 0xF6EEDD).opacity(0.14), lineWidth: 1))
                            .frame(maxWidth: 206, alignment: .leading)
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 6) {
                        if group != nil { tag(locale.t("bookings.groupTag")) }
                        statusBadge
                    }
                }

                Spacer(minLength: 0)

                Text(headline)
                    .font(.cfDisplay(22, weight: .bold))
                    .foregroundStyle(Color(hex: 0xFBF4E6))
                    .lineLimit(2)
                    .strikethrough(isCancelled, color: Color(hex: 0xFBF4E6).opacity(0.5))
                    .fixedSize(horizontal: false, vertical: true)

                if let underline {
                    Text(underline.uppercased())
                        .font(.cfMono(9.5)).kerning(1.2)
                        .foregroundStyle(Color(hex: 0xFFEBC4).opacity(0.92))
                        .lineLimit(1)
                        .padding(.top, 5)
                }
            }
            .padding(.init(top: 12, leading: 16, bottom: 14, trailing: 16))
        }
        .frame(height: 140)
    }

    private func tag(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.cfMono(8.5)).kerning(1.4)
            .foregroundStyle(Color(hex: 0xF6EEDD))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Color(hex: 0x080605).opacity(0.34), in: .capsule)
            .overlay(Capsule().stroke(Color(hex: 0xF6EEDD).opacity(0.28), lineWidth: 1))
    }

    @ViewBuilder private var statusBadge: some View {
        if isCancelled {
            badge(locale.t("bookings.statusCancelled"),
                  fill: Color(hex: 0x080605).opacity(0.42),
                  text: Color(hex: 0xF6EEDD).opacity(0.6), bordered: true)
        } else if isCheckedIn {
            badge(locale.t("bookings.statusCheckedIn"), icon: "checkmark",
                  fill: Explore.accent.opacity(0.9), text: Explore.onAccent)
        } else if isTonight {
            badge(locale.t("bookings.liveTonight"), pulsing: true,
                  fill: Explore.ember, text: Color(hex: 0xFFF1E8))
        } else {
            badge(locale.t("bookings.statusConfirmed"),
                  fill: Color(hex: 0x080605).opacity(0.42),
                  text: Color(hex: 0xF6EEDD), bordered: true)
        }
    }

    private func badge(_ text: String, icon: String? = nil, pulsing: Bool = false,
                       fill: Color, text textColour: Color, bordered: Bool = false) -> some View {
        HStack(spacing: 5) {
            if pulsing { TicketPulseDot() }
            if let icon {
                Image(systemName: icon).font(.system(size: 8, weight: .bold))
            }
            Text(text.uppercased())
                .font(.cfMono(8.5)).kerning(1.3)
        }
        .foregroundStyle(textColour)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(fill, in: .capsule)
        .overlay {
            if bordered {
                Capsule().stroke(Color(hex: 0xF6EEDD).opacity(0.18), lineWidth: 1)
            }
        }
    }

    // ── Stub ──────────────────────────────────────────────────────────────────

    private var stub: some View {
        VStack(alignment: .leading, spacing: 0) {
            factStrip
                .padding(.top, 8)
                .padding(.bottom, 13)
                .overlay(alignment: .bottom) {
                    DashedRule()
                }

            if let line = lineupLine {
                HStack(alignment: .top, spacing: 9) {
                    Text(locale.t("bookings.playing").uppercased())
                        .font(.cfMono(8)).kerning(1.5)
                        .foregroundStyle(Explore.ink3)
                        .padding(.top, 2)
                    Text(line)
                        .font(.cfSans(12.5))
                        .foregroundStyle(Explore.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.top, 12)
            }

            qrRow.padding(.top, 13)

            if showWallet && !isCancelled && !isCheckedIn {
                WalletPassButton(
                    passPath: "/api/bookings/\(booking.id.uuidString.lowercased())/wallet",
                    fullWidth: true
                )
                .padding(.top, 14)
            }

            if group != nil {
                Button {
                    Haptics.tap()
                    onOpenGroup()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "person.2.fill").font(.system(size: 12))
                        Text(locale.t("bookings.seeWhosGoing"))
                            .font(.cfSans(13, weight: .medium))
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Explore.ink3)
                    }
                    .foregroundStyle(Explore.ink)
                }
                .padding(.top, 14)
            }
        }
        .padding(.init(top: 2, leading: 16, bottom: 16, trailing: 16))
        .background(Explore.surface)
    }

    /// Date · Doors · Guests · Entry. Doors comes from the EVENT when there is
    /// one — the old card hard-coded "23:00" for every ticket, which was wrong
    /// for events and a guess everywhere else. With no real time we show a dash
    /// rather than inventing one.
    private var factStrip: some View {
        HStack(alignment: .top, spacing: 10) {
            fact(locale.t("bookings.factDate"), Self.shortDate(booking.bookingDate))
            fact(locale.t("bookings.factDoors"),
                 event?.doorsLabel ?? "—",
                 sub: event?.closesLabel.map { String(format: locale.t("bookings.till"), $0) })
            fact(locale.t("bookings.factGuests"), "\(booking.partySize)")
            fact(locale.t("events.entry"), entryLabel)
        }
    }

    private var entryLabel: String {
        if let total = booking.totalAmount, total > 0 {
            return "€\(String(format: "%.0f", total))"
        }
        return locale.t("rumbalist.free")
    }

    private func fact(_ label: String, _ value: String, sub: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased())
                .font(.cfMono(8)).kerning(1.5)
                .foregroundStyle(Explore.ink3)
                .padding(.bottom, 5)
            Text(value)
                .font(.cfDisplay(15))
                .foregroundStyle(Explore.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            if let sub {
                Text(sub)
                    .font(.cfMono(9)).kerning(0.7)
                    .foregroundStyle(Explore.ink2)
                    .padding(.top, 3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Solomun, Nina Kraviz +3 more" — headliner emphasised, tail counted.
    private var lineupLine: AttributedString? {
        guard let credits = event?.credits, !credits.isEmpty else { return nil }
        var out = AttributedString(credits[0].name)
        out.foregroundColor = Explore.ink
        out.font = .cfSans(12.5, weight: .semibold)
        if credits.count > 1 {
            var second = AttributedString(", \(credits[1].name)")
            second.foregroundColor = Explore.ink2
            out += second
        }
        if credits.count > 2 {
            var more = AttributedString(" " + String(format: locale.t("bookings.plusMore"), credits.count - 2))
            more.foregroundColor = Explore.ink3
            out += more
        }
        return out
    }

    private var qrRow: some View {
        HStack(spacing: 14) {
            Button {
                Haptics.tap()
                onShowQR()
            } label: {
                Group {
                    if let token = booking.doorToken {
                        QRCodeView(token: token)
                            .frame(width: 68, height: 68)
                    } else {
                        Image(systemName: "qrcode")
                            .font(.system(size: 30))
                            .foregroundStyle(Theme.onQRSurface.opacity(0.25))
                            .frame(width: 68, height: 68)
                    }
                }
                .padding(7)
                // Fixed white in both appearances — a scanner needs the quiet
                // zone, so this surface never follows the theme.
                .background(Theme.qrSurface, in: .rect(cornerRadius: 11))
                .grayscale(isCancelled ? 1 : 0)
                .opacity(isCancelled ? 0.45 : 1)
            }
            .disabled(isCancelled || booking.doorToken == nil)

            VStack(alignment: .leading, spacing: 0) {
                Text(locale.t("rumbalist.reference").uppercased())
                    .font(.cfMono(8)).kerning(1.5)
                    .foregroundStyle(Explore.ink3)
                    .padding(.bottom, 5)
                if let reference = booking.qrCodeToken {
                    Text(reference.prefix(13).uppercased())
                        .font(.cfMono(12)).kerning(0.6)
                        .foregroundStyle(Explore.ink)
                }
                Text(doorNote)
                    .font(.cfSans(12))
                    .foregroundStyle(Explore.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
            Spacer(minLength: 0)
        }
    }

    private var doorNote: String {
        if isCancelled { return locale.t("bookings.cancelledNote") }
        if isCheckedIn { return locale.t("bookings.checkedInNote") }
        return locale.t("bookings.atDoor")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Parsed in Barcelona, not the device's zone — the night belongs to the
    /// venue's day.
    private static func isToday(_ date: String) -> Bool {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        guard let d = f.date(from: String(date.prefix(10))) else { return false }
        return cal.isDateInToday(d)
    }

    private static func shortDate(_ date: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        f.locale = Locale(identifier: "en_US_POSIX")
        guard let d = f.date(from: String(date.prefix(10))) else { return date }
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "Europe/Madrid")
        out.locale = Locale(identifier: "en_GB")
        out.dateFormat = "EEE d MMM"
        return out.string(from: d)
    }
}

/// The dashed rule under the fact strip (`border-bottom: 1px dashed`).
private struct DashedRule: View {
    var body: some View {
        Rectangle()
            .fill(.clear)
            .frame(height: 1)
            .overlay(
                Rectangle()
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .foregroundStyle(Explore.lineStrong)
                    .frame(height: 1)
                    .clipped()
            )
    }
}

/// `.tk__dot` — the live marker's expanding ring, in the badge's own ink.
private struct TicketPulseDot: View {
    @State private var animating = false

    var body: some View {
        Circle()
            .fill(Color(hex: 0xFFF1E8))
            .frame(width: 6, height: 6)
            .overlay {
                Circle()
                    .stroke(Color(hex: 0xFFF1E8), lineWidth: 1.5)
                    .padding(-4)
                    .scaleEffect(animating ? 1.4 : 0.5)
                    .opacity(animating ? 0 : 0.8)
                    .animation(.easeOut(duration: 1.8).repeatForever(autoreverses: false),
                               value: animating)
            }
            .onAppear { animating = true }
    }
}
