import Foundation

/// Canonical URLs for the public legal pages. Kept in one place so every
/// in-app link points at the same hosted document — if the marketing domain
/// changes, edit here.
enum LegalURLs {
    static let terms   = URL(string: "https://clubfuoco.com/legal/terms")!
    static let privacy = URL(string: "https://clubfuoco.com/legal/privacy")!
    static let help    = URL(string: "https://clubfuoco.com/legal/help")!
}
