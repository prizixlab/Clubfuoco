import Foundation

/// The two hosts this app talks to over HTTPS, and why they are different.
///
/// Both serve the same Vercel deployment. The split exists because they are
/// reached by different parties over different networks:
///
/// - `api` is called by THIS APP, from wherever a promoter happens to be
///   standing — which is a club, a venue office, a campus. Those networks run
///   category filters, and `clubfuoco.com` is a small uncategorised domain that
///   a filter will happily reset mid-handshake. That surfaces in the UI as
///   "A TLS error caused the secure connection to fail." on every screen that
///   calls the web API (payouts, Wallet pass branding) while the rest of the
///   app carries on working, because the rest of the app talks to Supabase.
///   Observed 30 Sep 2026 on a venue-scale Wi-Fi network: failed on Wi-Fi,
///   worked immediately on cellular, cert and chain verified healthy from
///   outside. `vercel.app` sits under a well-known hosting domain that the same
///   filters pass, which is why the consumer app — which has always used it —
///   never hit this.
///
/// - `brand` is what a HUMAN sees: invite links we hand to guests, and the
///   legal documents App Store Connect points at. Those must stay on the
///   branded apex. A guest is not going to trust `clubfuoco.vercel.app` in a
///   WhatsApp message, and the App Store record cannot point somewhere else.
///
/// So: machine traffic takes the route that survives hostile networks, and
/// human-facing links keep the name. Do not collapse these back into one.
enum WebHost {
    /// Base for `/api/**` calls made by the app itself.
    static let api = "https://clubfuoco.vercel.app"

    /// Base for URLs a person reads, shares or taps outside the app.
    static let brand = "https://clubfuoco.com"
}
