import Foundation

/// Buying a spot on a paid promoter night: the invite screen and the event
/// page both go through here, so there is one purchase flow, not two.
///
/// Native Apple Pay first (1.14+): the server creates an unconfirmed
/// PaymentIntent and holds the spot (POST /payment-intent), the Apple Pay
/// sheet confirms it on-device, then verify-payment settles the spot at once
/// rather than waiting on the webhook. A phone without Apple Pay falls back to
/// Stripe Checkout in Safari, the only flow ≤1.13 builds have.
///
/// Every check that can refuse the sale is on the server and is the same for
/// both routes (lib/spot-sale), so the fallback can never sell what Apple Pay
/// would have refused.
enum SpotPayment {
    enum Outcome: Sendable {
        /// The spot is theirs. `guestId` is their row — the ticket.
        case paid(guestId: String)
        /// No Apple Pay on this device: send them to Stripe Checkout.
        case openCheckout(URL)
        /// They closed the Apple Pay sheet. The hold has been released.
        case cancelled
    }

    private struct Body: Encodable, Sendable {
        let fullName: String
        let plusOnes: Int
    }

    @MainActor
    static func buy(
        api: APIClient, token: String, fullName: String, plusOnes: Int, label: String
    ) async throws -> Outcome {
        guard ApplePayService.isAvailable else {
            return try await checkout(api: api, token: token, fullName: fullName, plusOnes: plusOnes)
        }

        struct Intent: Decodable, Sendable {
            let clientSecret: String?
            let guestId: String?
            let amountCents: Int?
            let alreadyPaid: Bool?
        }
        let intent: Intent = try await api.post(
            "/api/promoter-invites/\(token)/payment-intent",
            body: Body(fullName: fullName, plusOnes: plusOnes))

        // Bought already, on this account — straight to the ticket, never a
        // second charge.
        if intent.alreadyPaid == true, let id = intent.guestId { return .paid(guestId: id) }
        guard let secret = intent.clientSecret, let guestId = intent.guestId,
              let cents = intent.amountCents else {
            throw APIError.emptyData
        }

        do {
            try await ApplePayService.confirmIntent(
                amount: Double(cents) / 100, label: label, clientSecret: secret)
        } catch {
            // Closed the sheet, or the card was declined: give the spot back now
            // rather than holding it for half an hour. The server asks Stripe
            // first and keeps the spot if the charge did go through.
            await release(api: api, token: token, guestId: guestId)
            if (error as? ApplePayError) == .cancelled { return .cancelled }
            throw error
        }

        // Paid. Settle the row now; the webhook is the backstop if this fails.
        struct Verified: Decodable, Sendable { let paid: Bool }
        _ = try? await api.post("/api/promoter-invites/guest/\(guestId)/verify-payment") as Verified
        return .paid(guestId: guestId)
    }

    @MainActor
    private static func checkout(
        api: APIClient, token: String, fullName: String, plusOnes: Int
    ) async throws -> Outcome {
        struct Reply: Decodable, Sendable { let url: String?; let alreadyPaid: Bool?; let guestId: String? }
        let reply: Reply = try await api.post(
            "/api/promoter-invites/\(token)/checkout",
            body: Body(fullName: fullName, plusOnes: plusOnes))
        if reply.alreadyPaid == true, let id = reply.guestId { return .paid(guestId: id) }
        guard let raw = reply.url, let url = URL(string: raw) else { throw APIError.emptyData }
        return .openCheckout(url)
    }

    @MainActor
    private static func release(api: APIClient, token: String, guestId: String) async {
        struct Body: Encodable, Sendable { let guestId: String }
        struct Reply: Decodable, Sendable { let released: Bool }
        _ = try? await api.delete(
            "/api/promoter-invites/\(token)/payment-intent", body: Body(guestId: guestId)) as Reply
    }
}
