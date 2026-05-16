import Foundation
import UIKit
import Capacitor
import StoreKit

/**
 * Iap — native StoreKit 2 bridge for Club Fuoco memberships.
 *
 * Sells the auto-renewable subscription products defined in App Store Connect
 * (Subscription Group: "Club Fuoco Membership"). The JS layer never trusts the
 * device: every purchase returns the signed `jwsRepresentation`, which the
 * backend verifies against Apple's certificates before granting a tier.
 *
 * Registered with Capacitor via CAPBridgedPlugin conformance — no .m file needed.
 */
@available(iOS 15.0, *)
@objc(IapPlugin)
public class IapPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "IapPlugin"
    public let jsName = "Iap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts",        returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase",           returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases",   returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise),
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Listen for transactions that arrive outside an explicit purchase
        // (renewals processed while the app is closed, Ask-to-Buy approvals,
        //  purchases made on another device). Forwarded to JS so the backend
        //  can re-verify and keep the membership in sync.
        updatesTask = Task.detached { [weak self] in
            for await update in Transaction.updates {
                guard let self = self else { return }
                if case .verified(let transaction) = update {
                    await transaction.finish()
                    self.notifyListeners("transactionUpdate", data: [
                        "productId": transaction.productID,
                        "jws": update.jwsRepresentation,
                    ])
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - getProducts

    @objc func getProducts(_ call: CAPPluginCall) {
        guard let ids = call.getArray("productIds", String.self), !ids.isEmpty else {
            call.reject("productIds is required")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                let payload = products.map { p -> [String: Any] in
                    [
                        "productId":       p.id,
                        "displayName":     p.displayName,
                        "description":     p.description,
                        "displayPrice":    p.displayPrice,
                        "price":           NSDecimalNumber(decimal: p.price).doubleValue,
                    ]
                }
                call.resolve(["products": payload])
            } catch {
                call.reject("Failed to load products: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - purchase

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("productId is required")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    call.reject("Product not found in App Store: \(productId)")
                    return
                }

                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        await transaction.finish()
                        call.resolve([
                            "status":    "purchased",
                            "productId": transaction.productID,
                            "jws":       verification.jwsRepresentation,
                        ])
                    case .unverified:
                        call.reject("Purchase could not be verified by StoreKit")
                    }
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    // Ask-to-Buy / SCA — resolved later via Transaction.updates
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.reject("Unknown purchase result")
                }
            } catch {
                call.reject("Purchase failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - restorePurchases

    @objc func restorePurchases(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                let entitlements = await collectEntitlements()
                call.resolve(["entitlements": entitlements])
            } catch {
                call.reject("Restore failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - currentEntitlements

    @objc func currentEntitlements(_ call: CAPPluginCall) {
        Task {
            let entitlements = await collectEntitlements()
            call.resolve(["entitlements": entitlements])
        }
    }

    // MARK: - manageSubscriptions

    /// Opens Apple's native "Manage Subscriptions" sheet, where the user can
    /// downgrade, change, or cancel their Club Fuoco membership. Apple requires
    /// subscription cancellation to go through this system UI.
    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
                ?? UIApplication.shared.connectedScenes.first as? UIWindowScene
            guard let scene = scene else {
                call.reject("No active window scene")
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                call.reject("Could not open subscription management: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Helpers

    /// Returns every currently-active subscription as a verified JWS payload.
    private func collectEntitlements() async -> [[String: Any]] {
        var out: [[String: Any]] = []
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result {
                out.append([
                    "productId": transaction.productID,
                    "jws":       result.jwsRepresentation,
                ])
            }
        }
        return out
    }
}
