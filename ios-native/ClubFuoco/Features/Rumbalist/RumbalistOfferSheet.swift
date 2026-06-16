import SwiftUI
import Observation

/// Native port of RumbalistBookSheet — the dark, pink-accented sheet that
/// opens from a venue's Rumbalist offer. Free guestlist joins via
/// /api/rumbalist/join-guestlist; VIP tables run the Apple Pay flow
/// (create-vip-intent → confirm on-device → confirm-vip). Ends on a pass
/// step with the door QR.
struct RumbalistOfferSheet: View {
    let offer: RumbalistOffer
    let clubId: String
    let venueName: String
    let venueAddress: String
    /// Called with the new group id after "Bring your crew" / "Split with
    /// friends" creates a group — the parent opens it to invite friends.
    var onPlanWithFriends: ((UUID) -> Void)? = nil

    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan
    @Environment(\.dismiss) private var dismiss
    @State private var model = RumbalistOfferModel()
    @State private var calendarMessage: String?

    private static let ink = Color(hex: 0x141416)
    private static let textColor = Color(hex: 0xF5F5F7)

    var body: some View {
        ZStack {
            Self.ink.ignoresSafeArea()
            VStack(spacing: 0) {
                // Pink top rule + lockup
                Rectangle().fill(RumbalistMark.pink).frame(height: 2)
                RumbalistMark(height: 22)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)

                if let booking = model.confirmation {
                    passStep(booking)
                } else {
                    reviewStep
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // ── Review ────────────────────────────────────────────────────────────────

    private var reviewStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Kicker
                Group {
                    if offer.isVip {
                        HStack(spacing: 6) {
                            Label("Apple Pay", systemImage: "applelogo")
                                .font(.cfSans(13, weight: .semibold))
                                .foregroundStyle(Self.textColor)
                            Spacer()
                        }
                    } else {
                        // Centered under the big RUMBA lockup; no mark here (it
                        // sits right above, repeating it crowds the kicker).
                        Text(locale.t("rumbalist.titleFree").uppercased())
                            .font(.cfMono(10))
                            .kerning(2.2)
                            .foregroundStyle(Self.textColor.opacity(0.7))
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
                .padding(.bottom, 18)

                // Title / amount
                if offer.isVip {
                    Text(locale.t("rumbalist.payClubFuoco"))
                        .font(.cfSans(13))
                        .foregroundStyle(Self.textColor.opacity(0.55))
                    Text(offer.priceEur.map { "€\(String(format: "%.2f", $0))" } ?? locale.t("rumbalist.free"))
                        .font(.cfSerif(32, italic: true))
                        .foregroundStyle(Self.textColor)
                } else {
                    Text(locale.t("rumbalist.joinGuestlistAt"))
                        .font(.cfSans(13))
                        .foregroundStyle(Self.textColor.opacity(0.55))
                    Text(venueName)
                        .font(.cfSerif(30, italic: true))
                        .foregroundStyle(Self.textColor)
                        .lineLimit(2)
                }

                // Details card
                VStack(spacing: 0) {
                    detailRow(offer.isVip ? locale.t("rumbalist.payTo") : locale.t("rumbalist.operator")) {
                        HStack(spacing: 4) {
                            Text(locale.t("rumbalist.via")).foregroundStyle(Self.textColor)
                            RumbalistMark(height: 11)
                        }
                    }
                    divider
                    detailRow(locale.t("rumbalist.venue")) { Text(venueName).foregroundStyle(Self.textColor) }
                    detailRow(locale.t("rumbalist.address"), small: true) { Text(venueAddress).foregroundStyle(Self.textColor.opacity(0.7)) }
                    divider
                    detailRow(localizedTitle, small: true) { Text(offer.subtitle).foregroundStyle(Self.textColor.opacity(0.7)) }
                    detailRow(locale.t("rumbalist.valid"), small: true) { Text(offer.validDays).foregroundStyle(Self.textColor.opacity(0.7)) }
                    detailRow(locale.t("rumbalist.dressCode"), small: true) { Text(offer.dressCode).foregroundStyle(Self.textColor.opacity(0.7)) }
                    if offer.isVip, let price = offer.priceEur {
                        divider
                        detailRow(locale.t("rumbalist.total"), bold: true) {
                            Text("€\(String(format: "%.2f", price))").foregroundStyle(Self.textColor)
                        }
                    }
                }
                .padding(.init(top: 14, leading: 16, bottom: 14, trailing: 16))
                .background(.white.opacity(0.05), in: .rect(cornerRadius: 14))
                .padding(.top, 22)

                if let error = model.errorMessage {
                    Text(error)
                        .font(.cfSans(12))
                        .foregroundStyle(Color(hex: 0xFFB4A2))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                }

                // Confirm button
                Button {
                    confirm()
                } label: {
                    Group {
                        if offer.isVip {
                            if model.busy {
                                Text(locale.t("rumbalist.openingApplePay"))
                            } else {
                                Label(locale.t("rumbalist.pay"), systemImage: "applelogo")
                            }
                        } else {
                            HStack(spacing: 8) {
                                Text(locale.t("rumbalist.freeGuestlistWith"))
                                RumbalistMark(height: 17, animated: false)
                            }
                        }
                    }
                    .font(.cfSans(16, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(offer.isVip ? Color.white : Color(hex: 0xF3EEE0), in: .rect(cornerRadius: 12))
                    .opacity(model.busy ? 0.55 : 1)
                }
                .disabled(model.busy)
                .padding(.top, 22)

                Text(offer.isVip ? locale.t("rumbalist.vipFooter") : locale.t("rumbalist.freeFooter"))
                    .font(.cfSans(11))
                    .foregroundStyle(Self.textColor.opacity(0.45))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)

                // ── Going with friends — create a group for this offer ──────
                Button {
                    Haptics.tap()
                    model.createGroup(offer: offer, clubId: clubId, planDate: plan.date, api: api) { groupId in
                        onPlanWithFriends?(groupId)
                        dismiss()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.2")
                            .font(.system(size: 16))
                        Text(locale.t(offer.isVip ? "rumbalist.splitFriends" : "rumbalist.bringCrew"))
                            .font(.cfSans(15, weight: .medium))
                    }
                    .foregroundStyle(Self.textColor)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.18)))
                }
                .padding(.top, 14)

                Text(locale.t(offer.isVip ? "rumbalist.splitFriendsNote" : "rumbalist.bringCrewNote"))
                    .font(.cfSans(11))
                    .foregroundStyle(Self.textColor.opacity(0.45))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
    }

    private var localizedTitle: String {
        locale.t(offer.isVip ? "rumbalist.titleVip" : "rumbalist.titleFree")
    }

    private func detailRow(_ label: String, small: Bool = false, bold: Bool = false, @ViewBuilder value: () -> some View) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.cfSans(small ? 11 : 12))
                .foregroundStyle(Self.textColor.opacity(0.5))
            Spacer(minLength: 16)
            value()
                .font(.cfSans(small ? 11 : 13, weight: bold ? .bold : .regular))
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 7)
    }

    private var divider: some View {
        Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.vertical, 3)
    }

    // ── Pass / confirmation ───────────────────────────────────────────────────

    private func passStep(_ booking: RumbalistBookingResult) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 16) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(RumbalistMark.pink)
                        .padding(.top, 4)
                    Text(offer.isVip ? locale.t("rumbalist.tableBooked") : locale.t("rumbalist.onDoorList"))
                        .font(.cfSerif(24, italic: true))
                        .foregroundStyle(Self.textColor)
                        .multilineTextAlignment(.center)

                    // Reassure them it isn't lost when they dismiss this sheet.
                    HStack(spacing: 6) {
                        Image(systemName: "ticket.fill")
                            .font(.system(size: 11))
                        Text(locale.t("rumbalist.savedToTickets"))
                            .font(.cfSans(11))
                            .multilineTextAlignment(.center)
                    }
                    .foregroundStyle(Self.textColor.opacity(0.6))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(.white.opacity(0.06), in: .rect(cornerRadius: 10))

                    if let token = booking.qrCodeToken {
                        VStack(spacing: 10) {
                            QRCodeView(token: token)
                                .frame(width: 200, height: 200)
                                .padding(16)
                                .background(Color.white, in: .rect(cornerRadius: 16))
                            Text(locale.t("rumbalist.atDoor"))
                                .font(.cfSans(12))
                                .foregroundStyle(Self.textColor.opacity(0.55))
                        }
                    }

                    // Booking details
                    VStack(spacing: 0) {
                        detailRow(locale.t("rumbalist.venue")) { Text(venueName).foregroundStyle(Self.textColor) }
                        detailRow(locale.t("rumbalist.address"), small: true) { Text(venueAddress).foregroundStyle(Self.textColor.opacity(0.7)) }
                        divider
                        detailRow(locale.t("rumbalist.date")) { Text(confirmedDateText).foregroundStyle(Self.textColor) }
                        detailRow(locale.t("rumbalist.offer"), small: true) { Text(localizedTitle).foregroundStyle(Self.textColor.opacity(0.7)) }
                        detailRow(locale.t("rumbalist.time"), small: true) { Text(timeText).foregroundStyle(Self.textColor.opacity(0.7)) }
                        detailRow(locale.t("rumbalist.valid"), small: true) {
                            Text(String(format: locale.t("rumbalist.validNight"), confirmedDateText)).foregroundStyle(Self.textColor.opacity(0.7))
                        }
                        detailRow(locale.t("rumbalist.dressCode"), small: true) { Text(offer.dressCode).foregroundStyle(Self.textColor.opacity(0.7)) }
                        if let code = booking.qrCodeToken {
                            divider
                            detailRow(locale.t("rumbalist.reference"), small: true) {
                                Text(code).font(.cfMono(11)).foregroundStyle(Self.textColor.opacity(0.7))
                            }
                        }
                    }
                    .padding(.init(top: 14, leading: 16, bottom: 14, trailing: 16))
                    .background(.white.opacity(0.05), in: .rect(cornerRadius: 14))

                    Text(locale.t("rumbalist.validNote"))
                        .font(.cfSans(10))
                        .foregroundStyle(Self.textColor.opacity(0.45))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)

                    // Add to Wallet / Calendar
                    VStack(spacing: 10) {
                        WalletPassButton(passPath: "/api/bookings/\(booking.id.uuidString.lowercased())/wallet",
                                         fullWidth: true, light: true)
                        calendarButton
                    }

                    if let calendarMessage {
                        Text(calendarMessage)
                            .font(.cfSans(11))
                            .foregroundStyle(Self.textColor.opacity(0.6))
                    }
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 16)
            }

            Button {
                dismiss()
            } label: {
                Text(locale.t("common.done"))
                    .font(.cfSans(15, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Color(hex: 0xF3EEE0), in: .rect(cornerRadius: 12))
            }
            .padding(.horizontal, 22)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
    }

    private var calendarButton: some View {
        Button {
            Haptics.tap()
            Task {
                do {
                    try await CalendarService.addNightEvent(
                        title: String(format: locale.t("groups.calendarTitle"), venueName),
                        dateString: plan.date,
                        location: venueAddress.isEmpty ? venueName : venueAddress,
                        notes: "\(localizedTitle) · \(offer.subtitle)"
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
                    .font(.system(size: 14))
                Text(locale.t("groups.addToCalendar"))
                    .font(.cfSans(14, weight: .medium))
            }
            .foregroundStyle(Self.textColor)
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.18)))
        }
    }

    /// The Rumbalist cutoff for the Time row: "Works until <deadline>", where
    /// the deadline is pulled from the offer subtitle (e.g. "Free till 02:30
    /// AM"). Falls back to the door window when there's no cutoff (VIP tables).
    private var timeText: String {
        if let range = offer.subtitle.range(of: "till ", options: .caseInsensitive) {
            let deadline = offer.subtitle[range.upperBound...].trimmingCharacters(in: .whitespaces)
            if !deadline.isEmpty {
                return String(format: locale.t("rumbalist.worksUntil"), deadline)
            }
        }
        return offer.timeWindow
    }

    /// The planned night, formatted as a full weekday + date for the pass.
    private var confirmedDateText: String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.timeZone = .current
        guard let date = parser.date(from: plan.date) else { return plan.nightPhrase(locale: locale) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        formatter.setLocalizedDateFormatFromTemplate("EEEE d MMM")
        return formatter.string(from: date)
    }

    private func confirm() {
        Haptics.tap()
        if offer.isVip {
            model.payVip(offer: offer, clubId: clubId, venueName: venueName, api: api)
        } else {
            model.joinFree(clubId: clubId, venueName: venueName, api: api)
        }
    }
}

/// Minimal booking result for the Rumbalist endpoints (the row may not carry
/// every Booking field, so decode only what the pass needs).
struct RumbalistBookingResult: Decodable, Sendable {
    let id: UUID
    let qrCodeToken: String?
}

@MainActor
@Observable
final class RumbalistOfferModel {
    private(set) var busy = false
    private(set) var confirmation: RumbalistBookingResult?
    var errorMessage: String?

    func joinFree(clubId: String, venueName: String, api: APIClient) {
        busy = true
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable {
                    let clubId: String
                    let venueName: String
                    let productName: String
                }
                let result: RumbalistBookingResult = try await api.post(
                    "/api/rumbalist/join-guestlist",
                    body: Body(clubId: clubId, venueName: venueName, productName: "Free Guestlist")
                )
                Haptics.success()
                confirmation = result
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    /// "Bring your crew" / "Split with friends" — create a group for this
    /// offer (mirrors createGroup in RumbalistBookSheet), then hand the id up
    /// so the caller can open it to invite friends. Free → organizer doesn't
    /// pay; VIP → organizer covers the table by default.
    func createGroup(offer: RumbalistOffer, clubId: String, planDate: String, api: APIClient, onCreated: @escaping (UUID) -> Void) {
        busy = true
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable {
                    let clubId: String
                    let bookingType: String
                    let bookingDate: String
                    let organizerPays: Bool
                    let organizerAmount: Double
                    let members: [String]
                }
                struct Result: Decodable, Sendable { let id: UUID }
                let result: Result = try await api.post("/api/groups", body: Body(
                    clubId: clubId,
                    bookingType: offer.isVip ? "vip" : "general",
                    bookingDate: planDate,
                    organizerPays: offer.isVip,
                    organizerAmount: offer.isVip ? (offer.priceEur ?? 0) : 0,
                    members: []
                ))
                Haptics.success()
                onCreated(result.id)
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    func payVip(offer: RumbalistOffer, clubId: String, venueName: String, api: APIClient) {
        guard let price = offer.priceEur else { return }
        busy = true
        errorMessage = nil
        Task {
            do {
                // 1. Unconfirmed PaymentIntent
                struct IntentBody: Encodable {
                    let clubId: String
                    let amount: Int
                    let currency: String
                }
                struct IntentResult: Decodable, Sendable {
                    let clientSecret: String
                    let paymentIntentId: String
                }
                let intent: IntentResult = try await api.post(
                    "/api/rumbalist/create-vip-intent",
                    body: IntentBody(clubId: clubId, amount: Int((price * 100).rounded()), currency: "eur")
                )

                // 2. Apple Pay confirms it on-device
                try await ApplePayService.confirmIntent(amount: price, label: venueName, clientSecret: intent.clientSecret)

                // 3. Server reconciles + writes the booking
                struct ConfirmBody: Encodable {
                    let paymentIntentId: String
                    let clubId: String
                    let venueName: String
                    let productName: String
                }
                let result: RumbalistBookingResult = try await api.post(
                    "/api/rumbalist/confirm-vip",
                    body: ConfirmBody(paymentIntentId: intent.paymentIntentId, clubId: clubId,
                                      venueName: venueName, productName: "VIP Table")
                )
                Haptics.success()
                confirmation = result
            } catch let error as ApplePayError where error == .cancelled {
                // User closed the sheet
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}
