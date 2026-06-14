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
                HStack(spacing: 6) {
                    if offer.isVip {
                        Label("Apple Pay", systemImage: "applelogo")
                            .font(.cfSans(13, weight: .semibold))
                            .foregroundStyle(Self.textColor)
                    } else {
                        Text(locale.t("rumbalist.titleFree").uppercased())
                            .font(.cfMono(10))
                            .kerning(2.2)
                            .foregroundStyle(Self.textColor.opacity(0.7))
                        RumbalistMark(height: 13)
                    }
                    Spacer()
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
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 40))
                .foregroundStyle(RumbalistMark.pink)
            Text(offer.isVip ? locale.t("rumbalist.tableBooked") : locale.t("rumbalist.onDoorList"))
                .font(.cfSerif(24, italic: true))
                .foregroundStyle(Self.textColor)
            if let token = booking.qrCodeToken {
                QRCodeView(token: token)
                    .frame(width: 200, height: 200)
                    .padding(16)
                    .background(Color.white, in: .rect(cornerRadius: 16))
            }
            Text(locale.t("rumbalist.atDoor"))
                .font(.cfSans(12))
                .foregroundStyle(Self.textColor.opacity(0.55))
            Spacer()
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
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 24)
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
