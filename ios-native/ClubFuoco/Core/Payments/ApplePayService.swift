import Foundation
import PassKit
@_spi(STP) import StripeApplePay

/// Apple Pay → Stripe bridge.
///
/// The native payment UX is always the Apple Pay sheet; Stripe stays the
/// processor. STPApplePayContext authorizes the PKPayment and hands us a
/// Stripe PaymentMethod (pm_…); we then call the existing backend endpoint
/// (POST /api/bookings or /api/groups/[id]/join) which creates + confirms
/// the PaymentIntent server-side with that payment_method_id — the exact
/// contract the web PaymentForm uses. `COMPLETE_WITHOUT_CONFIRMING_INTENT`
/// (SPI, pinned via Package.resolved) tells the sheet the merchant confirmed
/// server-side, so its checkmark reflects the real charge outcome.
enum ApplePayError: LocalizedError, Equatable {
    case unavailable
    case cannotPresent
    case cancelled

    var errorDescription: String? {
        switch self {
        case .unavailable: return "Apple Pay is not available on this device"
        case .cannotPresent: return "Could not open Apple Pay"
        case .cancelled: return "Payment cancelled"
        }
    }
}

@MainActor
final class ApplePayService: NSObject {
    static let merchantId = "merchant.com.clubfuoco.app"   // NEXT_PUBLIC_APPLE_PAY_MERCHANT_ID
    // Publishable key — public by design, same value the web bundle ships.
    static let publishableKey = "pk_live_51TUZjoPYwQoNJs8HRUX7UdaAuiReqiigmjiBjLplzEK3CtAx3JtNmpnZI0aNskVohOzRbvVN4XZKYr26CJKoDg5900YNTeeaw2"

    static var isAvailable: Bool {
        PKPaymentAuthorizationController.canMakePayments()
    }

    /// Two backend integration shapes, both fronted by the Apple Pay sheet:
    /// - `.serverConfirm`: backend creates + confirms the PaymentIntent with
    ///   the PaymentMethod id (bookings, group joins).
    /// - `.clientSecret`: backend already created an unconfirmed PaymentIntent;
    ///   STPApplePayContext confirms it on-device (Rumbalist VIP).
    private enum Mode {
        case serverConfirm(charge: (String) async throws -> Void)
        case clientSecret(String)
    }

    private var mode: Mode = .serverConfirm(charge: { _ in })
    private var chargeError: Error?
    private var continuation: CheckedContinuation<Void, Error>?
    // Keep the service alive while the sheet is up
    private static var active: ApplePayService?

    /// Present the Apple Pay sheet for `amount` EUR. Once authorized, `charge`
    /// runs with the Stripe PaymentMethod id (call the backend there); its
    /// success/failure drives the sheet's checkmark. Throws .cancelled when
    /// the user closes the sheet.
    static func pay(
        amount: Double,
        label: String,
        charge: @escaping (_ paymentMethodId: String) async throws -> Void
    ) async throws {
        guard isAvailable else { throw ApplePayError.unavailable }
        let service = ApplePayService()
        active = service
        defer { active = nil }
        try await service.run(amount: amount, label: label, mode: .serverConfirm(charge: charge))
    }

    /// Present the Apple Pay sheet to confirm an existing PaymentIntent
    /// (the backend made it unconfirmed and returned `clientSecret`).
    /// STPApplePayContext confirms it; throws .cancelled on dismissal.
    static func confirmIntent(amount: Double, label: String, clientSecret: String) async throws {
        guard isAvailable else { throw ApplePayError.unavailable }
        let service = ApplePayService()
        active = service
        defer { active = nil }
        try await service.run(amount: amount, label: label, mode: .clientSecret(clientSecret))
    }

    private func run(amount: Double, label: String, mode: Mode) async throws {
        self.mode = mode
        STPAPIClient.shared.publishableKey = Self.publishableKey

        let request = StripeAPI.paymentRequest(
            withMerchantIdentifier: Self.merchantId,
            country: "ES",
            currency: "EUR"
        )
        request.paymentSummaryItems = [
            PKPaymentSummaryItem(label: label, amount: NSDecimalNumber(value: amount)),
        ]

        guard let context = STPApplePayContext(paymentRequest: request, delegate: self) else {
            throw ApplePayError.cannotPresent
        }

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            continuation = cont
            context.presentApplePay()
        }
    }
}

extension ApplePayService: ApplePayContextDelegate {
    nonisolated func applePayContext(
        _ context: STPApplePayContext,
        didCreatePaymentMethod paymentMethod: StripeAPI.PaymentMethod,
        paymentInformation: PKPayment,
        completion: @escaping STPIntentClientSecretCompletionBlock
    ) {
        Task { @MainActor in
            switch self.mode {
            case .serverConfirm(let charge):
                do {
                    try await charge(paymentMethod.id)
                    completion(STPApplePayContext.COMPLETE_WITHOUT_CONFIRMING_INTENT, nil)
                } catch {
                    self.chargeError = error
                    completion(nil, error)
                }
            case .clientSecret(let secret):
                // Let STPApplePayContext confirm the intent with this method.
                completion(secret, nil)
            }
        }
    }

    nonisolated func applePayContext(
        _ context: STPApplePayContext,
        didCompleteWith status: STPApplePayContext.PaymentStatus,
        error: Error?
    ) {
        Task { @MainActor in
            switch status {
            case .success:
                self.continuation?.resume()
            case .userCancellation:
                self.continuation?.resume(throwing: ApplePayError.cancelled)
            case .error:
                self.continuation?.resume(throwing: self.chargeError ?? error ?? ApplePayError.cannotPresent)
            }
            self.continuation = nil
        }
    }
}
