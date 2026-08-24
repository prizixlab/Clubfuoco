import SwiftUI
import StripeConnect
import UIKit

/// The in-app replacement for the hosted Stripe onboarding link.
///
/// StripeConnect's embedded account-onboarding component renders Stripe's own
/// KYC flow — the same identity/bank collection Stripe legally has to run — but
/// *inside the app*, in a full-screen controller Stripe presents itself (with
/// its own close button), instead of bouncing the promoter out to Safari. It is
/// driven by a single-use account-session client secret our backend mints
/// (`/api/promoter/payouts/session`); the SDK asks for it through
/// `fetchClientSecret` and never sees our user token or the Connect account id.
///
/// The manager is held for the lifetime of the presenting screen (a
/// @StateObject) so the component and its session survive being on screen. The
/// controller retains itself while presented, so we don't have to.
final class PayoutOnboardingModel: NSObject, ObservableObject, AccountOnboardingControllerDelegate {
    let manager: EmbeddedComponentManager

    /// Fired when the promoter finishes or backs out — the caller re-checks
    /// payout status, because Stripe's answer may have changed.
    var onExit: (() -> Void)?

    override init() {
        manager = EmbeddedComponentManager {
            // Returning nil tells the SDK the secret is unavailable; it shows
            // its own retry UI rather than us throwing across the bridge. The
            // repo is built inside the (main-actor) fetch so this init stays
            // nonisolated — SwiftUI evaluates @StateObject defaults off-actor.
            await Self.fetchClientSecret()
        }
        super.init()
    }

    @MainActor
    private static func fetchClientSecret() async -> String? {
        guard let session = try? await PromoterRepo().payoutSession() else { return nil }
        // MUST happen before the component makes its first request. The manager
        // uses STPAPIClient.shared, and StripeCore's validateKey() calls
        // assertionFailure on a nil key — which traps in a debug build, so the
        // app simply vanishes when you tap the button. This closure runs before
        // anything else the SDK does, which makes it the right place.
        if let key = session.publishableKey, !key.isEmpty {
            STPAPIClient.shared.publishableKey = key
        }
        return session.clientSecret
    }

    /// Presents Stripe's embedded onboarding from the top-most view controller.
    @MainActor
    func present() {
        guard let top = Self.topViewController() else { return }
        let controller = manager.createAccountOnboardingController()
        controller.delegate = self
        controller.present(from: top)
    }

    func accountOnboardingDidExit(_ accountOnboarding: AccountOnboardingController) {
        onExit?()
    }

    @MainActor
    private static func topViewController() -> UIViewController? {
        let key = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        var top = key?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
