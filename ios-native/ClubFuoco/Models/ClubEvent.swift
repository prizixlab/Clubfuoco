import Foundation

/// An upcoming event at one venue, from public.events (the agentbox RA feed —
/// see EVENTS_INGEST_BRIEF.md). Native mirror of ClubEvent in src/lib/events.ts.
///
/// Distinct from `ExternalEvent`, which models the older, thinner `ra_events`
/// cache the explore feed still reads. Events here are linked to a venue by
/// `club_id` resolved at ingest, so no fuzzy venue-name matching is involved.
struct ClubEvent: Decodable, Sendable, Identifiable, Hashable {
    let raEventId: String
    let title: String
    let date: String              // yyyy-MM-dd, the listing day
    let startTime: String?        // ISO instant; already the correct Madrid time
    let venueName: String?
    let promoters: [String]?
    let artists: [String]?
    let interested: Int?
    let attending: Int?
    let raUrl: String?
    // `cost` is deliberately not modelled. It is free text on the source
    // ("0", "10€", "", "€") and the brief is explicit that it is unreliable —
    // showing it as a price would misstate what the door actually costs.

    var id: String { raEventId }

    var ticketsURL: URL? { raUrl.flatMap(URL.init(string:)) }

    /// ("SUN", "19", "JUL") for the date block. Parsed with a fixed calendar so
    /// the day never shifts with the device timezone.
    var dateParts: (weekday: String, day: String, month: String) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.timeZone = cal.timeZone
        parser.locale = Locale(identifier: "en_GB")
        guard let parsed = parser.date(from: date) else { return ("", date, "") }

        let out = DateFormatter()
        out.timeZone = cal.timeZone
        out.locale = Locale(identifier: "en_GB")
        out.dateFormat = "EEE"
        let weekday = out.string(from: parsed).uppercased()
        out.dateFormat = "d"
        let day = out.string(from: parsed)
        out.dateFormat = "MMM"
        return (weekday, day, out.string(from: parsed).uppercased())
    }

    /// "23:00" in Barcelona time — the stored instant is correct, so render it
    /// in the venue's zone rather than the reader's.
    var startLabel: String? {
        guard let startTime else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = iso.date(from: startTime) ?? {
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            return plain.date(from: startTime)
        }()
        guard let parsed else { return nil }
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "Europe/Madrid")
        out.locale = Locale(identifier: "en_GB")
        out.dateFormat = "HH:mm"
        return out.string(from: parsed)
    }

    var lineup: [String] { Array((artists ?? []).prefix(6)) }
    var extraArtists: Int { max(0, (artists ?? []).count - lineup.count) }
}
