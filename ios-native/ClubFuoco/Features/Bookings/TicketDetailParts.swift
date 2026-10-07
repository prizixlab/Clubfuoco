import SwiftUI

// The three pieces that make a ticket page look like a ticket page: the
// full-bleed hero, the QR card that overlaps it, and the facts strip under it.
//
// They live here rather than inside BookingDetailView because a booking is not
// the only thing that is a ticket. A claimed promoter-guestlist invite is one
// too, and its screen used to be a completely different object — centred serif
// name, bare QR on the page background, no hero, no facts — so the same guest
// got two unrelated designs depending on how the night reached them. Anything
// that draws a ticket draws these.
//
// All three are driven by TicketCardData, the same shape TicketCard uses, so
// the list card and the page it opens can never describe a night differently.

// MARK: - Hero

struct TicketHero: View {
    let data: TicketCardData
    /// The supplier's colour when a night carries one, else the house ember.
    var accent: Color = Theme.ember
    /// "RUMBA GUESTLIST", "NIGHTLIFE" — the line above the venue name.
    var attribution: String?
    /// Short code for the header pill. Nil hides the pill.
    var codeLabel: String?
    var onBack: () -> Void
    /// Nil hides the help button — not every ticket has a help sheet.
    var onHelp: (() -> Void)?
    /// The big title. Defaults to the venue; an event ticket passes the
    /// event's own name, since "D9 Aribau" doesn't say which night it is.
    var headline: String? = nil

    @Environment(LocaleStore.self) private var locale

    var body: some View {
        ZStack(alignment: .top) {
            Color(hex: 0x2A1F1A)
                .overlay {
                    if let url = data.coverImageUrl.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) {
                            $0.resizable().aspectRatio(contentMode: .fill)
                        } placeholder: { Color(hex: 0x2A1F1A) }
                    }
                }
                .frame(height: 340)
                .clipped()
                // Deep wine scrim: dark enough at the bottom for the title and
                // for the QR card's shadow to sit on, clear at the middle so the
                // venue photo still reads.
                .overlay(
                    LinearGradient(
                        stops: [
                            .init(color: .black.opacity(0.55), location: 0.00),
                            .init(color: .black.opacity(0.10), location: 0.34),
                            .init(color: Color(hex: 0x4A1313).opacity(0.72), location: 0.78),
                            .init(color: Color(hex: 0x2A1F1A).opacity(0.95), location: 1.00),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )

            VStack(spacing: 0) {
                controls
                Spacer(minLength: 0)
                title
            }
            .padding(.horizontal, 20)
            // Clears the status bar — the hero runs under it.
            .padding(.top, 56)
            .padding(.bottom, 62)
        }
        .frame(height: 340)
    }

    private var controls: some View {
        HStack(spacing: 10) {
            circleButton("chevron.left") { Haptics.tap(); onBack() }
            Spacer(minLength: 8)
            if let codeLabel {
                Text(codeLabel)
                    .font(.cfMono(9)).kerning(1.2)
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.black.opacity(0.34), in: .capsule)
                    .overlay(Capsule().stroke(.white.opacity(0.16)))
            }
            Spacer(minLength: 8)
            if let onHelp {
                circleButton("questionmark") { Haptics.tap(); onHelp() }
            } else {
                // Keeps the code pill centred when there is no help button.
                Color.clear.frame(width: 36, height: 36)
            }
        }
    }

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

    private var title: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text(attribution ?? locale.t("bookings.nightlife"))
                    .font(.cfMono(9)).kerning(1.4)
                    .foregroundStyle(.white.opacity(0.8))
                    .lineLimit(1)
                Spacer(minLength: 6)
                statusBadge
            }
            Text(headline ?? data.venueName ?? data.eventTitle ?? "—")
                .font(.cfSerif(34, italic: true))
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            Text(meta)
                .font(.cfMono(9)).kerning(1.2)
                .foregroundStyle(.white.opacity(0.78))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var meta: String {
        [TicketFormat.dateLabel(data.date, locale: locale).uppercased(),
         data.doorsLabel,
         data.neighborhood?.uppercased()]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private var statusBadge: some View {
        let (key, color): (String, Color) = switch data.status {
        case "cancelled": ("bookings.statusCancelled", Color(hex: 0x888888))
        case "pending":   ("bookings.statusPending", Theme.gold)
        case "used":      ("bookings.statusCheckedIn", Theme.gold)
        default:          ("bookings.statusConfirmed", accent)
        }
        return Text(locale.t(key).uppercased())
            .font(.cfSans(9, weight: .semibold))
            .kerning(0.8)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(.black.opacity(0.34), in: .capsule)
            .overlay(Capsule().stroke(color.opacity(0.35)))
    }
}

// MARK: - QR card (overlaps the hero)

struct TicketQRCard: View {
    /// What the QR encodes.
    let token: String
    /// Printed under the QR so it can be read aloud when a scan fails. Nil
    /// prints nothing — better than printing a code the door would reject.
    var printed: String?

    @Environment(LocaleStore.self) private var locale

    var body: some View {
        VStack(spacing: 14) {
            Text(locale.t("bookings.atDoor").uppercased())
                .font(.cfMono(9)).kerning(1.5)
                .foregroundStyle(Theme.wine)
            QRCodeView(token: token)
                .frame(width: 208, height: 208)
            if let printed {
                Text(printed)
                    .font(.cfMono(11)).kerning(1.2)
                    .foregroundStyle(Theme.onQRSurface)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .padding(.horizontal, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 20)
        // Always white with dark modules in both modes — door scanners read the
        // physical contrast, not the appearance.
        .background(Theme.qrSurface, in: .rect(cornerRadius: 20))
        .shadow(color: Color(hex: 0x221E1A).opacity(0.16), radius: 18, y: 8)
    }
}

// MARK: - Facts strip

struct TicketStatsStrip: View {
    let data: TicketCardData
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack(alignment: .top, spacing: 10) {
                cell(locale.t("bookings.factDate"), TicketFormat.dateLabel(data.date, locale: locale))
                cell(locale.t("bookings.factDoors"), data.doorsLabel ?? "23:00")
                cell(locale.t("bookings.factGuests"), "\(data.guests)")
                cell(locale.t("bookings.factTicket"), ticketValue)
            }
            .padding(.vertical, 16)
            Rectangle().fill(Theme.hairline).frame(height: 1)
        }
    }

    /// What was paid, when something was ("€7", "€12.50") — a bought ticket
    /// labelled "Guestlist" or "General" reads as if it was free. A VIP
    /// booking keeps its tier name.
    private var ticketValue: String {
        if let total = data.totalAmount, total > 0, data.ticketTypeKey != "bookings.vip" {
            return total == total.rounded()
                ? "€\(Int(total))"
                : String(format: "€%.2f", total)
        }
        return locale.t(data.ticketTypeKey)
    }

    private func cell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased())
                .font(.cfMono(8)).kerning(1)
                .foregroundStyle(Theme.fadedSand)
                .lineLimit(1)
            Text(value)
                .font(.cfSerif(17))
                .foregroundStyle(Theme.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.65)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Shared formatting

enum TicketFormat {
    /// "Tonight" on the night itself, otherwise a short date. Parsed in
    /// Barcelona, not the device's zone — the night belongs to the venue's day.
    @MainActor
    static func dateLabel(_ ymd: String, locale: LocaleStore) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "Europe/Madrid")
        guard let date = parser.date(from: String(ymd.prefix(10))) else { return ymd }

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        if cal.isDateInToday(date) { return locale.t("bookings.tonight") }

        let out = DateFormatter()
        out.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        out.timeZone = cal.timeZone
        out.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return out.string(from: date)
    }

    /// Full token, grouped in fours so it can be read aloud or typed at the door
    /// when a scan fails.
    static func grouped(_ token: String) -> String {
        stride(from: 0, to: token.count, by: 4).map { offset -> String in
            let start = token.index(token.startIndex, offsetBy: offset)
            let end = token.index(start, offsetBy: min(4, token.count - offset))
            return String(token[start..<end])
        }.joined(separator: " ")
    }
}
