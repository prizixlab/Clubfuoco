import Foundation

/// A ticketed event from `ra_events` — native mirror of ExternalEvent in
/// src/lib/tickets.ts. Ticket sales carry a markup, so a venue with an event
/// is monetisable and ranks above a plain venue in the feed (below deal
/// venues, which earn more).
///
/// Only the fields the feed needs are modelled; Codable ignores the rest.
/// Everything below `venueName` is optional so a column that drifts out of
/// the table degrades one signal instead of failing the whole decode.
struct ExternalEvent: Decodable, Sendable {
    let id: String
    let title: String?
    let venueName: String
    /// Local calendar day of the event. The table carries both `date` (naive
    /// local, "2026-07-18T00:00:00.000") and `event_date` (tz-aware); the feed
    /// uses `date` so the day matches the planner's local yyyy-MM-dd, exactly
    /// as the web does.
    let date: String?

    /// "yyyy-MM-dd" for tier matching, or nil when the row has no usable date.
    var calendarDay: String? {
        guard let date, date.count >= 10 else { return nil }
        return String(date.prefix(10))
    }
}

/// Fuzzy venue-name matching — port of venueMatchClient() / normName() /
/// VENUE_STOPWORDS in the web's explore/page.tsx. Event rows carry the
/// promoter's free-text venue name ("La Terrrazza"), which rarely equals the
/// club row's name, so the match is: exact after normalisation, or any shared
/// meaningful word (>3 chars, not a stopword).
enum VenueMatch {
    private static let stopwords: Set<String> = [
        "barcelona", "club", "bar", "the", "lounge", "hotel", "cafe", "music",
        "night", "live", "room", "space", "house", "disco", "dance", "party",
        "venue", "stage", "place", "sala", "local", "bcn", "spain",
    ]

    private static func normalized(_ s: String) -> String {
        let mapped = s.lowercased().map { ch -> Character in
            ch.isLetter || ch.isNumber ? ch : " "
        }
        return String(mapped).split(separator: " ").joined(separator: " ")
    }

    private static func meaningfulWords(_ s: String) -> [String] {
        normalized(s).split(separator: " ")
            .map(String.init)
            .filter { $0.count > 3 && !stopwords.contains($0) }
    }

    static func matches(_ a: String, _ b: String) -> Bool {
        let na = normalized(a), nb = normalized(b)
        if na == nb { return true }
        let wa = meaningfulWords(a)
        guard !wa.isEmpty else { return false }
        let wb = Set(meaningfulWords(b))
        return wa.contains { wb.contains($0) }
    }
}
