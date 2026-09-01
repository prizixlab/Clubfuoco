import SwiftUI

/// What comes up the moment a spot is reserved — and again whenever the guest
/// taps "View pass".
///
/// Deliberately the same three things a booking's manage section offers, in the
/// same order, because a reservation IS a booking: the door QR, Apple Wallet,
/// and the calendar. Reserving and then having to go hunting in Tickets for the
/// pass would make a free guest list feel less finished than a paid one.
struct ReservedSheet: View {
    let event: FeedEvent
    let bookingId: String
    /// The 128-bit door secret (`bookings.scan_token`). The CF- reference is a
    /// label and does NOT scan, so without this there is no working pass.
    let scanToken: String?
    /// The CF-XXXXXXXX display reference. Safe to show; never encoded in the QR.
    let reference: String?

    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var calendarMessage: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(Explore.accent)
                    .padding(.top, 8)

                Text(locale.t("events.reserved"))
                    .font(.cfDisplay(24, weight: .bold))
                    .foregroundStyle(Explore.ink)
                    .padding(.top, 12)

                Text(event.displayTitle)
                    .font(.cfSans(14))
                    .foregroundStyle(Explore.ink2)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)

                Text(event.metaLine(locale: locale).uppercased())
                    .font(.cfMono(10)).kerning(1.2)
                    .foregroundStyle(Explore.ink3)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)

                pass.padding(.top, 22)

                actions.padding(.top, 18)

                if let calendarMessage {
                    Text(calendarMessage)
                        .font(.cfSans(12))
                        .foregroundStyle(Explore.ink2)
                        .padding(.top, 10)
                }

                Button {
                    Haptics.tap()
                    dismiss()
                } label: {
                    Text(locale.t("common.done"))
                        .font(.cfSans(15, weight: .semibold))
                        .foregroundStyle(Explore.ink2)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Explore.bg)
    }

    /// The QR on a fixed white card in both appearances — a scanner needs the
    /// quiet zone, so this one surface never follows the theme.
    @ViewBuilder private var pass: some View {
        if let scanToken {
            VStack(spacing: 12) {
                QRCodeView(token: scanToken)
                    .frame(width: 190, height: 190)
                Text(locale.t("bookings.atDoor"))
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.onQRSurface.opacity(0.7))
                if let reference {
                    Text(reference.prefix(13).uppercased())
                        .font(.cfMono(11)).kerning(1.2)
                        .foregroundStyle(Theme.onQRSurface.opacity(0.5))
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity)
            .background(Theme.qrSurface, in: .rect(cornerRadius: 18))
        } else {
            // No token means we cannot render a working pass. Say so rather
            // than showing a QR that will not scan at the door.
            Text(locale.t("events.passUnavailable"))
                .font(.cfSans(13))
                .foregroundStyle(Explore.ink3)
                .multilineTextAlignment(.center)
                .padding(.vertical, 24)
        }
    }

    private var actions: some View {
        VStack(spacing: 10) {
            WalletPassButton(
                passPath: "/api/bookings/\(bookingId)/wallet",
                fullWidth: true
            )

            Button {
                Haptics.tap()
                addToCalendar()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 15, weight: .medium))
                    Text(locale.t("groups.addToCalendar"))
                        .font(.cfSans(14, weight: .semibold))
                }
                .foregroundStyle(Explore.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Explore.surface, in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Explore.lineStrong, lineWidth: 1))
            }
        }
    }

    private func addToCalendar() {
        Task {
            do {
                try await CalendarService.addNightEvent(
                    title: event.displayTitle,
                    dateString: event.nightDate,
                    location: event.address ?? event.venueName,
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
}
