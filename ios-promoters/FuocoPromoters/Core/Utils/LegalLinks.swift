import Foundation

/// The promoter-facing legal documents.
///
/// One definition, because these URLs appear in two places (the You tab footer
/// and Settings → Support & legal) and are also what App Store Connect points
/// at for this app record — a link that drifts between them is a compliance
/// problem, not just a broken tap.
///
/// These are deliberately NOT the consumer documents at /legal/terms and
/// /legal/privacy. The promoter relationship is different in kind: promoters
/// are paid, their nights are reviewed before publishing, and they receive
/// personal data about guests.
enum LegalLinks {
    static let terms   = URL(string: "https://clubfuoco.com/legal/promoters/terms")!
    static let privacy = URL(string: "https://clubfuoco.com/legal/promoters/privacy")!
}
