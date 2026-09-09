import Foundation

/// One event in the consumer Events tab — native mirror of `FeedEvent` in
/// src/app/api/events/feed/route.ts.
///
/// This is OUR event: a `promoter_nights` row, either a promoter's night or a
/// house night we run ourselves. It is not an `ExternalEvent` (the thin
/// `ra_events` ticket cache) and not a `ClubEvent` (the scraped RA listing
/// shown on a venue page). Those describe other people's events; this one we
/// can actually put someone on the door list for.
///
/// Everything past `nightDate` is optional so a column drifting out of the
/// payload degrades one line of a card rather than failing the whole decode.
/// One leg of a night that moves — "22:00 Bastión Beach Club, then 00:00 Opium".
///
/// A route is stored on the night itself (`promoter_nights.stops`) rather than
/// as separate events, so the guest reserves once and carries one pass. See
/// supabase/migrations/20260908_event_stops.sql.
struct EventStop: Decodable, Sendable, Hashable, Identifiable {
    /// Set when the stop is one of our venues, which is what lets the row open
    /// that club's page. Null for a free-text location.
    let clubId: String?
    let name: String
    /// Bare clocks, "HH:MM". An `end` earlier than its `start` is the next
    /// morning — the same convention `openTime`/`closeTime` already use.
    let start: String?
    let end: String?
    let note: String?

    /// Stable within one route: the same venue can appear twice (a night that
    /// returns to the first room), so the name alone is not an identity.
    var id: String { "\(name)|\(start ?? "")|\(end ?? "")" }

    /// "22:00 – 00:00", or whichever half exists.
    var timeLabel: String? {
        switch (start, end) {
        case let (s?, e?): return "\(s) – \(e)"
        case let (s?, nil): return s
        case let (nil, e?): return e
        default: return nil
        }
    }
}

struct FeedEvent: Decodable, Sendable, Identifiable, Hashable {
    let id: String
    let title: String?
    let nightDate: String            // yyyy-MM-dd, the listing day
    let openTime: String?            // "23:00:00" — a bare clock, no date
    let closeTime: String?
    let description: String?
    let venueName: String?
    let clubId: String?
    let address: String?
    let lat: Double?
    let lng: Double?
    let image: String?
    let photoUrls: [String]?
    /// Billed DJs in order. Reuses `LineupCredit` (from ClubEvent) because our
    /// events store the same shape the scraped RA feed does — `id` is an RA
    /// artist id, which is exactly what `djs.ra_artist_id` holds — so a credit
    /// resolves to a real DJ rather than matching by name.
    let lineup: [LineupCredit]?
    /// Who RUNS the night — a partner brand where we have one, else free text.
    /// Separate from `lineup`: a brand can host a night it does not play, and a
    /// resident can play a night another collective is hosting.
    let hosts: [LineupCredit]?
    /// The route, when the night moves between venues. Empty or absent for an
    /// ordinary single-venue night, which is most of them.
    let stops: [EventStop]?
    let totalCapacity: Int?
    let priceCents: Int?
    let currency: String?
    /// Our editorial pin — what we chose to lead with.
    let isPinned: Bool?
    /// The promoter's PAID promotion. Deliberately a separate signal: a pin is
    /// a judgement, this is a purchase, and the feed ranks them in that order.
    let featured: Bool?
    /// Run by Club Fuoco rather than by a promoter.
    let isHouse: Bool?

    var pinned: Bool { isPinned ?? false }
    var paid: Bool { featured ?? false }
    var house: Bool { isHouse ?? false }

    var displayTitle: String { title ?? venueName ?? "Event" }

    // ── Route ─────────────────────────────────────────────────────────────────

    /// The stops, guaranteed to be a real route or nothing. The server already
    /// collapses a one-stop list, but this repeats the rule rather than
    /// trusting it: a single dot is not a schedule, and the card would render
    /// one as though the night moved.
    var route: [EventStop] { (stops?.count ?? 0) >= 2 ? stops! : [] }

    var isRoute: Bool { !route.isEmpty }

    /// "Bastión Beach Club → Opium". This replaces the venue name wherever a
    /// card would otherwise print it — `venueName` is only the FIRST stop on a
    /// route, so showing it alone would say the night happens at one place.
    var routeLine: String? {
        isRoute ? route.map(\.name).joined(separator: " → ") : nil
    }

    /// The venue line for a card: the route when there is one, else the venue.
    var placeLine: String? { routeLine ?? venueName }

    // ── Dates ─────────────────────────────────────────────────────────────────
    // Parsed with a fixed Barcelona calendar rather than the device's. The
    // venues are here, so the listing day is theirs; letting a traveller's
    // timezone shift the date would move an event to the wrong night.

    private static var madrid: TimeZone { TimeZone(identifier: "Europe/Madrid") ?? .current }

    private var parsedDate: Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = Self.madrid
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.date(from: nightDate)
    }

    /// "Tonight" / "Tomorrow" / "Sat 12 Sep". The two relative labels are the
    /// ones people actually plan by; past that a date is clearer than a count.
    ///
    /// Main-actor isolated because `LocaleStore` is: it is observable UI state,
    /// and these are only ever called while building a view body.
    @MainActor func dayLabel(locale: LocaleStore) -> String {
        guard let parsed = parsedDate else { return nightDate }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Self.madrid
        if cal.isDateInToday(parsed) { return locale.t("plan.tonight") }
        if cal.isDateInTomorrow(parsed) { return locale.t("plan.tomorrow") }
        let out = DateFormatter()
        out.timeZone = Self.madrid
        out.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        out.dateFormat = "EEE d MMM"
        return out.string(from: parsed)
    }

    /// Is this event on tonight? Drives the live marker.
    var isTonight: Bool {
        guard let parsed = parsedDate else { return false }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Self.madrid
        return cal.isDateInToday(parsed)
    }

    /// "23:00 – 06:00", or just the opening time when there is no close.
    /// The stored values are bare clocks (`time without time zone`), so they
    /// are trimmed rather than parsed — there is no instant to convert.
    var timeLabel: String? {
        func clock(_ s: String?) -> String? {
            guard let s, s.count >= 5 else { return nil }
            return String(s.prefix(5))
        }
        guard let open = clock(openTime) else { return clock(closeTime) }
        guard let close = clock(closeTime) else { return open }
        return "\(open) – \(close)"
    }

    /// The meta line under a title: night, time and venue, skipping whatever is
    /// missing so it never renders a stray separator.
    @MainActor func metaLine(locale: LocaleStore) -> String {
        [dayLabel(locale: locale), timeLabel, placeLine]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    /// Every event on this feed is free to attend today: house events are
    /// forced free by a check constraint, and a promoter can only price a night
    /// once Stripe has enabled charges on their account. Kept as a computed
    /// property so the card asks a question rather than assuming the answer.
    var isFree: Bool { (priceCents ?? 0) == 0 }

    // ── Line-up ───────────────────────────────────────────────────────────────

    var credits: [LineupCredit] { lineup ?? [] }

    var hostCredits: [LineupCredit] { hosts ?? [] }

    /// "Club Fuoco × Nitsa" — co-hosts joined by a cross, the way a flyer bills
    /// them. nil when nobody is credited, so the fact tile is simply omitted.
    var hostLine: String? {
        let names = hostCredits.map(\.name)
        return names.isEmpty ? nil : names.joined(separator: " × ")
    }

    /// "Marea, Dyad, Iker Roig +2" — the billing, in order, with the tail
    /// counted rather than truncated mid-name.
    func lineupLine(max: Int = 3) -> String? {
        let all = credits
        guard !all.isEmpty else { return nil }
        let shown = all.prefix(max).map(\.name).joined(separator: ", ")
        let extra = all.count - min(max, all.count)
        return extra > 0 ? "\(shown) +\(extra)" : shown
    }
}
