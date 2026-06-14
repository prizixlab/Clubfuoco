import SwiftUI
import PassKit
import Observation

/// Native booking purchase — port of clubs/[id]/book with the Apple Pay
/// sheet replacing the web card form. Pricing mirrors calculateOrderTotal():
/// membership discount applies only at partner clubs; the 12% platform fee
/// is internal and never added on top of the charge.
struct BookNightSheet: View {
    let detail: PlaceDetail
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan
    @Environment(\.dismiss) private var dismiss
    @State private var model = BookNightViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let confirmation = model.confirmation {
                        confirmedView(confirmation)
                    } else {
                        form
                    }
                }
                .padding(20)
            }
            .background(Theme.cream)
            .navigationTitle(locale.t("book.cta"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(locale.t("common.cancel")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            model.configure(detail: detail, planDate: plan.date, tier: auth.profile?.membershipTier ?? "free")
        }
    }

    // ── Form ──────────────────────────────────────────────────────────────────

    private var form: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Booking type
            if detail.vipTableMinSpend ?? 0 > 0 {
                Picker("", selection: $model.bookingType) {
                    Text(locale.t("bookings.general")).tag("general")
                    Text(locale.t("bookings.vip")).tag("vip")
                }
                .pickerStyle(.segmented)
            }

            // Date — today through +14, same window the server enforces
            VStack(alignment: .leading, spacing: 6) {
                Kicker(locale.t("plan.day"), color: Theme.fadedSand, size: 9)
                Picker(locale.t("plan.day"), selection: $model.date) {
                    ForEach(PlanStore.dayOptions(locale: locale)) { option in
                        Text(option.label).font(.cfSerif(18)).tag(option.value)
                    }
                }
                .pickerStyle(.wheel)
                .frame(height: 110)
                .clipped()
                .background(Color.white, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
            }

            // Party size
            HStack {
                Kicker(locale.t("book.partySize"), color: Theme.fadedSand, size: 9)
                Spacer()
                Stepper("\(model.partySize)", value: $model.partySize, in: 1...20)
                    .font(.cfSerif(20))
                    .foregroundStyle(Theme.ink)
                    .fixedSize()
            }
            .padding(14)
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))

            // Summary
            VStack(spacing: 8) {
                summaryRow(locale.t("book.subtotal"), "€\(String(format: "%.2f", model.subtotal))")
                if model.discount > 0 {
                    summaryRow(locale.t("book.discount"), "−€\(String(format: "%.2f", model.discount))", color: Color(hex: 0x2D7A46))
                }
                Divider().overlay(Theme.hairline)
                HStack {
                    Text(locale.t("book.total"))
                        .font(.cfSerif(20))
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    Text("€\(String(format: "%.2f", model.total))")
                        .font(.cfSerif(24))
                        .foregroundStyle(Theme.wine)
                }
            }
            .padding(16)
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))

            if let error = model.errorMessage {
                FormError(message: error)
            }

            // Apple Pay
            if ApplePayService.isAvailable {
                ApplePayButton {
                    model.payAndBook(api: api, clubName: detail.name)
                }
                .frame(height: 50)
                .disabled(model.paying || model.total <= 0)
                .opacity(model.paying ? 0.5 : 1)
            } else {
                Text(locale.t("book.applePayUnavailable"))
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)
                    .frame(maxWidth: .infinity)
            }

            // Group night alternative
            Button {
                model.createGroup(api: api)
            } label: {
                Text(model.groupCode == nil
                     ? locale.t("book.planWithFriends")
                     : String(format: locale.t("book.groupCreated"), model.groupCode!))
                    .font(.cfSans(13, weight: .medium))
                    .foregroundStyle(model.groupCode == nil ? Theme.ink : Color(hex: 0x2D7A46))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
            }
            .disabled(model.paying || model.groupCode != nil)
        }
    }

    private func summaryRow(_ label: String, _ value: String, color: Color = Theme.stone) -> some View {
        HStack {
            Text(label)
                .font(.cfSans(13))
                .foregroundStyle(Theme.stone)
            Spacer()
            Text(value)
                .font(.cfSans(13, weight: .medium))
                .foregroundStyle(color)
        }
    }

    private func confirmedView(_ booking: Booking) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color(hex: 0x2D7A46))
                .padding(.top, 24)
            Text(locale.t("book.confirmed"))
                .font(.cfSerif(20))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            if let token = booking.qrCodeToken {
                QRCodeView(token: token)
                    .frame(width: 180, height: 180)
                    .padding(16)
                    .background(Color.white, in: .rect(cornerRadius: 16))
            }
            WalletPassButton(passPath: "/api/bookings/\(booking.id.uuidString.lowercased())/wallet")
            Button(locale.t("common.done")) { dismiss() }
                .font(.cfSans(14, weight: .semibold))
                .foregroundStyle(Theme.wine)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Native black Apple Pay button.
struct ApplePayButton: UIViewRepresentable {
    let action: () -> Void

    func makeUIView(context: Context) -> PKPaymentButton {
        let button = PKPaymentButton(paymentButtonType: .book, paymentButtonStyle: .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: PKPaymentButton, context: Context) {
        context.coordinator.action = action
    }

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    final class Coordinator {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}

// ── View model ────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class BookNightViewModel {
    var bookingType = "general"
    var date = ""
    var partySize = 1
    private(set) var paying = false
    private(set) var confirmation: Booking?
    private(set) var groupCode: String?
    var errorMessage: String?

    private var detail: PlaceDetail?
    private var membershipTier = "free"

    func configure(detail: PlaceDetail, planDate: String, tier: String) {
        guard self.detail == nil else { return }
        self.detail = detail
        self.membershipTier = tier
        self.date = PlanStore.isValid(planDate) ? planDate : PlanStore.today()
        if (detail.generalEntryPrice ?? 0) == 0, (detail.vipTableMinSpend ?? 0) > 0 {
            bookingType = "vip"
        }
    }

    var unitPrice: Double {
        bookingType == "vip" ? (detail?.vipTableMinSpend ?? 0) : (detail?.generalEntryPrice ?? 0)
    }

    // Mirrors calculateOrderTotal() — discounts only at partner clubs
    var subtotal: Double { unitPrice * Double(partySize) }
    var discount: Double {
        guard detail?.isPartner == true else { return 0 }
        let rate: Double = switch membershipTier {
        case "black": 0.30
        case "sapphire": 0.25
        case "gold": 0.15
        default: 0
        }
        return (subtotal * rate * 100).rounded() / 100
    }
    var total: Double { subtotal - discount }

    func payAndBook(api: APIClient, clubName: String) {
        guard let detail, total > 0 else { return }
        paying = true
        errorMessage = nil
        Task {
            do {
                // The charge closure runs inside the Apple Pay sheet — its
                // success drives the sheet's checkmark.
                try await ApplePayService.pay(amount: total, label: clubName) { paymentMethodId in
                    struct Body: Encodable {
                        let clubId: String
                        let bookingType: String
                        let partySize: Int
                        let bookingDate: String
                        let paymentMethodId: String
                    }
                    let booking: Booking = try await api.post("/api/bookings", body: Body(
                        clubId: detail.placeId,
                        bookingType: self.bookingType,
                        partySize: self.partySize,
                        bookingDate: self.date,
                        paymentMethodId: paymentMethodId
                    ))
                    self.confirmation = booking
                }
                Haptics.success()
            } catch let error as ApplePayError where error == .cancelled {
                // User closed the sheet — no error banner
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            paying = false
        }
    }

    /// "Plan it with friends" — creates an open group night instead of a
    /// solo booking; the organizer (and friends) pay their own entries from
    /// the group screen.
    func createGroup(api: APIClient) {
        guard let detail else { return }
        paying = true
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable {
                    let clubId: String
                    let bookingType: String
                    let bookingDate: String
                    let organizerPays: Bool
                    let members: [String]
                }
                struct Result: Decodable, Sendable {
                    let id: UUID
                    let inviteCode: String
                }
                let result: Result = try await api.post("/api/groups", body: Body(
                    clubId: detail.placeId,
                    bookingType: bookingType,
                    bookingDate: date,
                    // General entry is a free guestlist pass (pay at the door),
                    // so the organizer gets their QR right away. VIP tables are
                    // a real charge settled from the group screen.
                    organizerPays: bookingType == "vip",
                    members: []
                ))
                Haptics.success()
                groupCode = result.inviteCode
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            paying = false
        }
    }
}

