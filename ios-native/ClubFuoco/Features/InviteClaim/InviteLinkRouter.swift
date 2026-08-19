import Foundation
import SwiftUI

/// Holds the currently-pending invite token (if any) so RootView can present
/// the claim sheet on top of whatever the user was doing. Singleton because
/// Universal Link callbacks fire outside any view tree.
@MainActor
@Observable
final class InviteLinkRouter {
    static let shared = InviteLinkRouter()

    /// The token from /i/<token>. Set by `handle(url:)`, cleared when the
    /// sheet is dismissed. Used as the .sheet binding's identity.
    var pendingToken: String?

    /// Set when the link came back from Stripe Checkout carrying ?paid=1&guest=.
    ///
    /// Stripe's success_url is an https://clubfuoco.com/i/<token> URL, so it
    /// re-enters the app through the SAME Universal Link that opened the invite
    /// in the first place — and without reading the query the buyer would land
    /// back on the join form having just paid, with no sign anything happened.
    /// The id only jumps them to their ticket; the webhook is what actually
    /// marks the spot paid, so a forged query buys nothing.
    var paidGuestId: String?

    /// Returns true if we recognized this URL and handled it (caller should
    /// stop further processing). False otherwise — lets other handlers
    /// (Google Sign-In, etc.) try.
    @discardableResult
    func handle(url: URL) -> Bool {
        // Two URL shapes to recognize:
        //   1. Universal Link:    https://clubfuoco.com/i/<token>
        //   2. Custom scheme:     clubfuoco://i/<token>   (host == "i", first
        //                          path component is the token)
        // In #2 the token is in url.host's NEXT segment because URL parses
        // "clubfuoco://i/abc" as scheme=clubfuoco, host=i, path=/abc.
        if url.scheme == "clubfuoco" {
            guard url.host == "i" else { return false }
            let parts = url.path.split(separator: "/", omittingEmptySubsequences: true)
            guard let raw = parts.first, !raw.isEmpty else { return false }
            pendingToken = String(raw)
            return true
        }
        // Universal Link form
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count >= 2, parts[0] == "i" else { return false }
        let token = String(parts[1])
        guard !token.isEmpty else { return false }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        if items?.first(where: { $0.name == "paid" })?.value == "1" {
            paidGuestId = items?.first(where: { $0.name == "guest" })?.value
        }
        pendingToken = token
        return true
    }
}
