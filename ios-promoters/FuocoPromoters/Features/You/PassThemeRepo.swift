import Foundation

// The promoter's Apple Wallet pass branding. Talks to /api/promoter/pass-theme,
// which is caller-scoped (no id in the path) like /api/offers/me.
//
// The server sends back the DERIVED values — the value colour it picked and
// both contrast ratios — rather than leaving the app to recompute them. The
// preview therefore shows what the pass will actually use, and cannot drift
// away from the artifact a guest downloads.

/// What the server computed for a colour pair. `legible` is the gate on Save.
struct PassThemeDerived: Decodable, Hashable {
    let foreground: String        // "#RRGGBB"
    let valueRatio: Double
    let labelRatio: Double
    let legible: Bool
    let problems: [String]
}

struct PassTheme: Decodable, Hashable {
    let background: String        // "#RRGGBB"
    let accent: String            // "#RRGGBB"
    let logoText: String?
    let logoUrl: String?
    let hasLogo: Bool
    let status: String            // "active" | "under_review" | "blocked"
    let derived: PassThemeDerived

    /// The look every promoter starts on — the pass their guests get today.
    static let house = PassTheme(
        background: "#0A0807", accent: "#E8B65B",
        logoText: nil, logoUrl: nil, hasLogo: false, status: "active",
        derived: PassThemeDerived(
            foreground: "#FFF6E5", valueRatio: 18.7, labelRatio: 8.3,
            legible: true, problems: []))

    var isHouse: Bool {
        background.caseInsensitiveCompare(Self.house.background) == .orderedSame &&
        accent.caseInsensitiveCompare(Self.house.accent) == .orderedSame &&
        !hasLogo && (logoText?.isEmpty ?? true)
    }
}

@MainActor
final class PassThemeRepo {
    private let sb = SupabaseService.shared
    private static let webBase = "https://clubfuoco.com"

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; return d
    }()

    private struct Envelope<T: Decodable>: Decodable { let data: T? }
    private struct ThemeEnv: Decodable { let theme: PassTheme }

    private func request(_ method: String, body: [String: Any]? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: "\(Self.webBase)/api/promoter/pass-theme")!)
        req.httpMethod = method
        req.setValue("Bearer \(try await sb.client.auth.session.accessToken)",
                     forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            if let env = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = env["error"] as? String {
                throw OfferError.message(msg)
            }
            throw OfferError.message("Request failed (\(code))")
        }
        return data
    }

    private func theme(_ data: Data) throws -> PassTheme {
        guard let env = try Self.decoder.decode(Envelope<ThemeEnv>.self, from: data).data
        else { throw OfferError.message("Empty response") }
        return env.theme
    }

    /// The saved theme, or the house defaults when nothing has been saved.
    func load() async throws -> PassTheme {
        try theme(try await request("GET"))
    }

    /// Save colours / wordmark text. The server re-runs the legibility check
    /// and rejects with a 422 whose message names the failing pair.
    func save(background: String, accent: String, logoText: String?) async throws -> PassTheme {
        try theme(try await request("PATCH", body: [
            "background": background,
            "accent": accent,
            "logo_text": logoText as Any? ?? NSNull(),
        ]))
    }

    /// Back to the house look.
    func reset() async throws -> PassTheme {
        try theme(try await request("DELETE"))
    }
}
