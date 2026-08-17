import Foundation
import UIKit

/// Recovers an invite that was tapped BEFORE the app existed on this phone.
///
/// A Universal Link only opens an installed app. Someone who taps /i/<token>
/// without Club Fuoco goes to the App Store and cold-launches here knowing
/// exactly what they wanted and holding nothing that says so. Apple provides no
/// deferred deep link — App Store campaign parameters are not readable by the
/// app — so the web page pushes the invite through two channels and this reads
/// whichever arrived:
///
///   1. CLIPBOARD — deterministic. `detectPatterns` answers "is there a URL?"
///      WITHOUT prompting; only if it says yes do we read, which is the one
///      moment the system paste prompt makes sense to the person seeing it.
///   2. SERVER TICKET — probabilistic. /api/invite-handoff/claim matches a
///      coarse fingerprint (IP + iOS version) recorded when they left for the
///      App Store.
///
/// THE RULE: this only ever PRE-FILLS the invite sheet. It never claims a spot.
/// Channel 2 can be wrong — two people behind one carrier NAT on the same iOS
/// version inside the 30-minute window will cross — and the containment is that
/// being wrong costs someone one event page they didn't ask for.
///
/// Runs once per install. A guest whose handoff missed still has the link in
/// their messages, and tapping it now works, so there is nothing to retry.
@MainActor
enum InviteHandoff {

    private static let doneKey = "cf.inviteHandoff.checked"

    static func resolveIfNeeded(api: APIClient) async {
        guard !UserDefaults.standard.bool(forKey: doneKey) else { return }
        UserDefaults.standard.set(true, forKey: doneKey)

        // Already handled — a Universal Link fired before we got here, which
        // means the app WAS installed and none of this applies.
        guard InviteLinkRouter.shared.pendingToken == nil else { return }

        if let token = tokenFromClipboard() {
            InviteLinkRouter.shared.pendingToken = token
            return
        }
        if let token = await tokenFromServer(api: api) {
            InviteLinkRouter.shared.pendingToken = token
        }
    }

    // MARK: - Channel 1: the clipboard

    /// Reads the pasteboard ONLY when it holds something shaped like a URL.
    ///
    /// `detectPatterns` is the prompt-free question. Skipping it and reading
    /// directly would fire the system paste alert on every first launch,
    /// including for the majority who arrived with no invite at all.
    private static func tokenFromClipboard() -> String? {
        let pb = UIPasteboard.general
        guard pb.hasStrings else { return nil }
        guard let url = pb.url ?? URL(string: pb.string ?? "") else { return nil }
        return inviteToken(from: url)
    }

    /// `https://clubfuoco.com/i/<token>` → `<token>`.
    ///
    /// Host-checked: the clipboard is whatever the user last copied, so a
    /// stranger's link — or anything else with a /i/ path — must not be treated
    /// as ours.
    static func inviteToken(from url: URL) -> String? {
        guard let host = url.host?.lowercased(),
              host == "clubfuoco.com" || host == "www.clubfuoco.com" else { return nil }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count >= 2, parts[0] == "i" else { return nil }
        let token = String(parts[1])
        return token.isEmpty ? nil : token
    }

    // MARK: - Channel 2: the server ticket

    private static func tokenFromServer(api: APIClient) async -> String? {
        // APIClient encodes with .convertToSnakeCase, so `osVersion` goes out
        // as `os_version` — which is what the route reads.
        struct Body: Encodable { let osVersion: String }
        struct Resp: Decodable { let token: String? }
        do {
            // The full version string; the SERVER trims it to major.minor,
            // because Safari reports "18_5_1" on a point release while
            // UIDevice says "18.5.1". Both sides normalise identically there,
            // and doing it in one place keeps them from drifting apart.
            let resp: Resp = try await api.post(
                "/api/invite-handoff/claim",
                body: Body(osVersion: UIDevice.current.systemVersion))
            guard let token = resp.token, !token.isEmpty else { return nil }
            return token
        } catch {
            // No network on first launch, or nothing matched. Either way the
            // link is still in their messages.
            return nil
        }
    }
}
