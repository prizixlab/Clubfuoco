import Foundation

/// An upcoming event at one venue, from public.events (the agentbox RA feed —
/// see EVENTS_INGEST_BRIEF.md). Native mirror of ClubEvent in src/lib/events.ts.
///
/// Distinct from `ExternalEvent`, which models the older, thinner `ra_events`
/// cache the explore feed still reads. Events here are linked to a venue by
/// `club_id` resolved at ingest, so no fuzzy venue-name matching is involved.
/// One billed artist on an event, from `events.lineup`. `id` is RA's artist id
/// — the same key `djs.ra_artist_id` uses — so a credit joins to a DJ page
/// exactly. nil on rows scraped before the lineup field existed.
struct LineupCredit: Decodable, Sendable, Hashable, Identifiable {
    let id: String?
    let name: String

    /// Stable identity for ForEach: two DJs can share neither id nor position,
    /// but an id-less legacy credit still needs a key.
    var key: String { id ?? "name:\(name)" }
}

struct ClubEvent: Decodable, Sendable, Identifiable, Hashable {
    let raEventId: String
    let title: String
    let date: String              // yyyy-MM-dd, the listing day
    let startTime: String?        // ISO instant; already the correct Madrid time
    let venueName: String?
    let promoters: [String]?
    /// Names only, unordered — kept for rows that predate `lineup`.
    let artists: [String]?
    /// Ordered credits with RA artist ids (events.lineup jsonb).
    let lineup: [LineupCredit]?
    let interested: Int?
    let attending: Int?
    let raUrl: String?
    let image: String?            // flyer URL, where the scraper captured one
    let description: String?      // event copy (plain text), where RA had one
    let endTime: String?          // ISO instant; nights routinely cross midnight
    let minimumAge: Int?          // 18/20/21. nil = RA holds NO policy (see below)
    let venueCapacity: String?    // free text, and "0" in half the rows
    /// Free text on the source: "€12–€22", "0", "€", "10€/15€". Modelled now so
    /// the detail sheet can show a real door price, but only through
    /// `entryLabel`, which refuses anything that is not an actual amount.
    let cost: String?

    var id: String { raEventId }

    // No `ticketsURL`. `raUrl` is kept as internal provenance — where the row
    // came from, for support and de-duping — but is never surfaced: the source
    // of the listing is not something the customer is shown.

    /// A door price only when the source actually gave one.
    ///
    /// 60% of rows are "0", "€" or blank, and nothing distinguishes "free" from
    /// "unknown" — so anything without a non-zero digit is treated as unknown
    /// and the chip is simply not shown. Guessing here would misstate what
    /// someone pays at the door.
    var entryLabel: String? {
        guard let raw = cost?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else { return nil }
        let digits = raw.compactMap(\.wholeNumberValue)
        guard digits.contains(where: { $0 > 0 }) else { return nil }
        return raw
    }

    /// Capacity only when it is a real number. The column is non-null on 99% of
    /// rows but literally "0" on half of them, which is absence, not a room that
    /// holds nobody.
    var capacityLabel: String? {
        guard let raw = venueCapacity?.trimmingCharacters(in: .whitespacesAndNewlines),
              let n = Int(raw), n > 0 else { return nil }
        return n.formatted(.number.grouping(.automatic))
    }

    /// "23:00 – 06:00", plus whether the end lands on the next day. Median night
    /// here runs six hours and most end between 02:00 and 08:00, so the end time
    /// usually belongs to tomorrow — rendering it bare would read as wrong.
    var timeRange: (label: String, crossesMidnight: Bool)? {
        guard let start = Self.instant(startTime) else { return nil }
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "Europe/Madrid")
        out.locale = Locale(identifier: "en_GB")
        out.dateFormat = "HH:mm"
        guard let end = Self.instant(endTime) else {
            return (out.string(from: start), false)
        }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let crosses = !cal.isDate(start, inSameDayAs: end)
        return ("\(out.string(from: start)) – \(out.string(from: end))", crosses)
    }

    static func instant(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

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

    /// The billed lineup: every DJ on the night, in the order RA lists them,
    /// each with RA's artist id so a credit resolves to a DJ page exactly
    /// rather than by name.
    ///
    /// Falls back to the older `artists` name array (no ids, no order) for rows
    /// scraped before the lineup field existed — those credits still render,
    /// they just match by name.
    var credits: [LineupCredit] {
        if let lineup, !lineup.isEmpty { return lineup }
        return (artists ?? []).map { LineupCredit(id: nil, name: $0) }
    }

    /// Shown on the card; the rest sit behind a "+N".
    var visibleCredits: [LineupCredit] { Array(credits.prefix(6)) }
    var extraCredits: Int { max(0, credits.count - visibleCredits.count) }
}
