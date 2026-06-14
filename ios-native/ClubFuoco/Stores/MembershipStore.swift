import Foundation
import Observation
import StoreKit

/// StoreKit 2 membership purchases. Paid tiers are auto-renewable
/// subscriptions (App Store guideline 3.1.1); every signed transaction is
/// verified SERVER-side against Apple's cert chain via
/// POST /api/memberships/iap/verify — the device's claim is never trusted.
@MainActor
@Observable
final class MembershipStore {
    /// Must match App Store Connect (and src/lib/membership.ts).
    static let productIds = [
        "com.clubfuoco.app.membership.gold",
        "com.clubfuoco.app.membership.sapphire",
        "com.clubfuoco.app.membership.black",
    ]

    static func tier(for productId: String) -> String? {
        productId.split(separator: ".").last.map(String.init)
    }

    private(set) var products: [Product] = []
    private(set) var purchasing = false
    var errorMessage: String?

    private let api: APIClient
    private var updatesTask: Task<Void, Never>?

    init(api: APIClient) {
        self.api = api
    }

    /// Listen for renewals / out-of-band transactions and verify them too.
    func start() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.verifyWithServer(jws: update.jwsRepresentation)
                if case .verified(let tx) = update {
                    await tx.finish()
                }
            }
        }
    }

    func loadProducts() async {
        let loaded = (try? await Product.products(for: Self.productIds)) ?? []
        products = Self.productIds.compactMap { id in loaded.first { $0.id == id } }
    }

    private struct Grant: Decodable, Sendable {
        let tier: String
        let active: Bool
    }

    /// Purchase → server-verify the JWS → finish. Returns the granted tier.
    func purchase(_ product: Product) async -> String? {
        purchasing = true
        errorMessage = nil
        defer { purchasing = false }

        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let granted = await verifyWithServer(jws: verification.jwsRepresentation)
                if case .verified(let tx) = verification {
                    await tx.finish()
                }
                Haptics.success()
                return granted
            case .userCancelled, .pending:
                return nil
            @unknown default:
                return nil
            }
        } catch {
            Haptics.error()
            errorMessage = error.localizedDescription
            return nil
        }
    }

    /// Restore: send every current entitlement's JWS; the server grants the
    /// highest active tier.
    func restore() async -> String? {
        errorMessage = nil
        var entitlements: [[String: String]] = []
        for await result in Transaction.currentEntitlements {
            entitlements.append(["jws": result.jwsRepresentation])
        }
        guard !entitlements.isEmpty else { return nil }

        do {
            let granted: Grant = try await api.post(
                "/api/memberships/iap/verify",
                body: ["entitlements": entitlements]
            )
            return granted.tier
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    @discardableResult
    private func verifyWithServer(jws: String) async -> String? {
        do {
            let granted: Grant = try await api.post(
                "/api/memberships/iap/verify",
                body: ["jws": jws]
            )
            return granted.tier
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
