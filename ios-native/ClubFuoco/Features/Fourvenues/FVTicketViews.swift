import SwiftUI

extension TicketCardData {
    init(fourvenues t: FVTicket) {
        self.init(
            eventTitle: FVText.pretty(t.eventName),
            venueName: t.venue,
            neighborhood: nil,
            address: t.address,
            hostLine: "HypeList · \(FVText.pretty(t.productName) ?? "")",
            coverImageUrl: t.image,
            date: t.night,
            doorsLabel: t.doors,
            closesLabel: t.closes,
            credits: [],
            guests: t.heads,
            totalAmount: t.paidOnline,
            status: "confirmed",
            checkedInAt: nil,
            // The same code Fourvenues prints under their QR — scans identically.
            doorToken: t.qrPayload,
            reference: t.qrPayload,
            walletPath: "",
            ticketTypeKey: t.settle == Settle.online.rawValue ? "bookings.general" : "bookings.guestlistTag",
            payAtDoor: t.owedAtDoor
        )
    }
}

struct FVTicketDetailView: View {
    /// The ticket as it was when opened; `ticket` below follows the store so a
    /// QR read in the background appears without reopening.
    let initial: FVTicket
    let justIssued: Bool

    init(ticket: FVTicket, justIssued: Bool) {
        self.initial = ticket
        self.justIssued = justIssued
    }

    private var ticket: FVTicket {
        FVTicketStore.shared.tickets.first { $0.id == initial.id } ?? initial
    }

    @Environment(LocaleStore.self) private var locale
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    private static let ink = Color.adaptive(light: 0xF8F5EE, dark: 0x141416)
    private static let text = Color.adaptive(light: 0x221E1A, dark: 0xF5F5F7)
    private static func veil(_ o: Double) -> Color {
        Color.adaptive(light: 0x221E1A, lightAlpha: o, dark: 0xFFFFFF, darkAlpha: o)
    }
    private var accent: Color { Color(hexString: FVCatalog.brand.color) ?? Theme.ember }

    private var kicker: String {
        switch ticket.settle {
        case Settle.door.rawValue: return locale.t("fv.kickerDoor")
        case Settle.online.rawValue: return locale.t("fv.kickerTicket")
        case Settle.table.rawValue: return locale.t("rumbalist.titleVip")
        default: return locale.t("rumbalist.titleFree")
        }
    }

    var body: some View {
        ZStack {
            Self.ink.ignoresSafeArea()
            VStack(spacing: 0) {
                Rectangle().fill(accent).frame(height: 2)
                SupplierMark(brand: FVCatalog.brand, height: 20, tint: accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                ScrollView {
                    VStack(spacing: 16) {
                        Text(kicker.uppercased())
                            .font(.cfMono(10)).kerning(2.2)
                            .foregroundStyle(ticket.owedAtDoor != nil ? Theme.ember : Self.text.opacity(0.7))
                        VStack(spacing: 4) {
                            Text(FVText.pretty(ticket.eventName) ?? "")
                                .font(.cfSerif(28, italic: true))
                                .foregroundStyle(Self.text)
                            Text([ticket.venue, FVFormat.night(ticket.night), ticket.doors].compactMap { $0 }.joined(separator: " · "))
                                .font(.cfSans(13))
                                .foregroundStyle(Self.text.opacity(0.6))
                        }
                        .multilineTextAlignment(.center)

                        if let owed = ticket.owedAtDoor {
                            HStack(spacing: 12) {
                                Image(systemName: "eurosign.circle.fill").font(.system(size: 22))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(String(format: locale.t("fv.payAtDoorTitle"), owed.euros))
                                        .font(.cfSans(15, weight: .bold))
                                    Text(String(format: locale.t("fv.payAtDoorNote"), ticket.unitPrice.euros))
                                        .font(.cfSans(12))
                                }
                                Spacer(minLength: 0)
                            }
                            .foregroundStyle(.white)
                            .padding(14)
                            .background(Theme.ember, in: .rect(cornerRadius: 14))
                        }

                        qrCard

                        VStack(spacing: 0) {
                            row(kicker) { Text(FVText.pretty(ticket.productName) ?? "—") }
                            row(locale.t("fv.people")) { Text("\(ticket.heads)") }
                            if let a = ticket.address { row(locale.t("rumbalist.address"), small: true) { Text(a).opacity(0.7) } }
                            if let paid = ticket.paidOnline {
                                Rectangle().fill(Self.veil(0.08)).frame(height: 1).padding(.vertical, 3)
                                row(locale.t("rumbalist.total"), bold: true) { Text(paid.euros) }
                            }
                        }
                        .padding(.init(top: 10, leading: 16, bottom: 10, trailing: 16))
                        .background(Self.veil(0.05), in: .rect(cornerRadius: 14))

                        #if DEBUG
                        Button("Remove (debug)", role: .destructive) {
                            FVTicketStore.shared.remove(ticket); dismiss()
                        }
                        .font(.cfSans(12))
                        #endif
                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 28)
                }
            }
        }
        .presentationDetents([.large])
        .cfSheetGrabber()
        // Never a link out to Fourvenues (their page, their PDF): the QR is
        // ours to show. While it's pending, pull the account until it lands.
        .task(id: ticket.qrPayload == nil) {
            while ticket.qrPayload == nil && !Task.isCancelled {
                await FVAccountSync.sync(auth.queries.supabaseService)
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private var qrCard: some View {
        VStack(spacing: 10) {
            if let qr = ticket.qrPayload {
                QRCodeView(token: qr).frame(width: 230, height: 230)
                Text(qr).font(.cfMono(14, weight: .semibold)).foregroundStyle(Theme.onQRSurface)
            } else {
                ProgressView().controlSize(.large).tint(accent)
                    .frame(height: 120)
                Text(locale.t("fv.gettingTicketNote"))
                    .font(.cfSans(12)).foregroundStyle(Theme.onQRSurface.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(Theme.qrSurface, in: .rect(cornerRadius: 18))
    }

    private func row(_ label: String, small: Bool = false, bold: Bool = false,
                     @ViewBuilder value: () -> some View) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.cfSans(small ? 11 : 12)).foregroundStyle(Self.text.opacity(0.5))
            Spacer(minLength: 16)
            value()
                .font(.cfSans(small ? 11 : 13, weight: bold ? .bold : .regular))
                .foregroundStyle(Self.text)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 7)
    }
}
