import Foundation

/// One priced wave of tickets, as the consumer sees it.
///
/// A wave ends on whichever comes first: its cut-off passing, or its allocation
/// selling out. The server decides which one is live (see lib/releases.ts) and
/// says so in `state` — nothing here re-derives it, because a client clock that
/// disagrees with the server's would show a price the till would not honour.
struct TicketRelease: Decodable, Hashable, Identifiable {
    let id: String
    let position: Int
    let name: String?
    let priceCents: Int
    /// When it stops selling, as the server's ISO timestamp. Nil = it runs
    /// until the doors open.
    ///
    /// Kept as a STRING deliberately. The shared APIClient decoder sets no
    /// dateDecodingStrategy, so it defaults to .deferredToDate and expects a
    /// NUMBER — a `Date` here made the whole events payload fail to decode,
    /// which emptied the feed of every event, not just the priced ones. Parsing
    /// is done here rather than by changing that decoder, which every other
    /// model already depends on.
    let endsAt: String?
    /// Tickets in this wave, in people. Nil = no limit.
    let quantity: Int?
    /// Heads already taken.
    let sold: Int
    /// "live" | "upcoming" | "sold_out" | "ended"
    let state: String

    var isLive: Bool { state == "live" }

    /// PostgREST sends fractional seconds ("…T09:21:53.185+00:00"); plenty of
    /// rows won't have them. Try both rather than assume.
    var endsAtDate: Date? {
        guard let endsAt else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: endsAt) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: endsAt)
    }

    var displayName: String { name?.nilIfEmpty ?? "Release \(position)" }

    var priceText: String {
        priceCents % 100 == 0
            ? "€\(priceCents / 100)"
            : String(format: "€%.2f", Double(priceCents) / 100)
    }

    /// "12 left" — only when the wave is limited AND live, because a count on a
    /// wave nobody can buy is noise, and on an unlimited one it is a lie.
    var remainingText: String? {
        guard isLive, let quantity else { return nil }
        let left = max(0, quantity - sold)
        return left == 0 ? nil : "\(left) left"
    }

    /// When this wave hands over, in the guest's words.
    func switchText(locale: LocaleStore) -> String? {
        guard let endsAt = endsAtDate else { return nil }
        let cal = Calendar.current
        if cal.isDateInToday(endsAt) {
            return "until \(endsAt.formatted(date: .omitted, time: .shortened)) tonight"
        }
        if cal.isDateInTomorrow(endsAt) {
            return "until tomorrow"
        }
        return "until \(endsAt.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))"
    }
}

private extension String {
    var nilIfEmpty: String? { trimmingCharacters(in: .whitespaces).isEmpty ? nil : self }
}
