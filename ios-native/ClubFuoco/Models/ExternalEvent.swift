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

/// Fuzzy venue-name matching — verbatim port of src/lib/venue-match.ts. Event
/// rows carry the promoter's free-text venue name ("La Terrrazza"), which
/// rarely equals the club row's name, so the match has to be fuzzy.
///
/// The web module is the source of truth; every case in venue-match.test.ts
/// appears in `runSelfChecks()` below, so the two cannot drift silently.
/// Change both together.
enum VenueMatch {
    /// Venue-type and address words — they say what a place IS or WHERE it is,
    /// never which one it is. The address entries matter because Remote Apollo
    /// emits placeholder rows whose "name" is really a street address ("TBA -
    /// Tech Barcelona Rooftop - Pier 01 - Plaça Pau Vila 1").
    private static let curatedGeneric: [String] = [
        // venue type
        "barcelona", "club", "bar", "the", "lounge", "hotel", "cafe", "cafes",
        "music", "night", "live", "room", "space", "house", "disco", "dance",
        "party", "venue", "stage", "place", "sala", "local", "bcn", "spain",
        "restaurant", "restaurante", "cocktail", "cocteleria", "rooftop", "terrace",
        "terraza", "terrassa", "beach", "playa", "garden", "jardin", "sky",
        "teatre", "teatro", "theatre", "studio", "mansion", "social", "pool",
        // street / neighbourhood / landmark
        "carrer", "calle", "plaza", "placa", "avinguda", "avenida", "passeig",
        "paseo", "rambla", "ramblas", "llobregat", "montjuic", "vila", "prat",
        "catalunya", "pier", "port", "mar", "costa",
        // bare colour adjectives
        "azul",
    ]

    /// Words recurring across the live Barcelona club corpus often enough to
    /// carry no identifying signal. Generated, not hand-picked: see
    /// `scripts/venue-stopwords.mjs`, which emits every word appearing in 3+
    /// distinct active club names. "bodega" is in 21 names and "cerveceria" in
    /// 9, while real venue names sit at 1-2 ("razzmatazz" 2, "apolo" 1).
    ///
    /// A minimum-length rule cannot substitute: 667 of 1000 club names reduce
    /// to one meaningful word, and the most distinctive venues are the short
    /// ones ("moog", "apolo", "pacha", "shoko", "sutton").
    private static let corpusGeneric: [String] = [
        "barceloneta", "beer", "bodega", "cafeteria", "cala", "casa", "cerveceria",
        "city", "entre", "frankfurt", "garage", "gaudi", "gracia", "gran", "granja",
        "hermanos", "irish", "jordi", "petit", "poblenou", "raco", "rincon", "rosa",
        "rose", "sant", "sants", "shisha", "tapas", "tavern", "taverna", "vermut",
    ]

    private static let stopwords: Set<String> =
        Set(curatedGeneric).union(corpusGeneric)

    /// Mirrors normName(): fold diacritics, lowercase, then reduce anything
    /// that is not ASCII alphanumeric to a single space. The ASCII check
    /// matters — without it a letter the fold cannot decompose would survive
    /// here but be stripped by the web's `[^a-z0-9]`, and the two would differ.
    private static func normalized(_ s: String) -> String {
        let folded = s
            .folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased()
        let mapped = folded.map { ch -> Character in
            ch.isASCII && (ch.isLetter || ch.isNumber) ? ch : " "
        }
        return String(mapped).split(separator: " ").joined(separator: " ")
    }

    private static func meaningfulWords(_ s: String) -> [String] {
        normalized(s).split(separator: " ")
            .map(String.init)
            .filter { $0.count > 3 && !stopwords.contains($0) }
    }

    /// True when both names plausibly denote the same venue. Three ways to
    /// match, strongest first:
    ///   1. identical after normalisation;
    ///   2. two or more shared meaningful words — two collisions are unlikely
    ///      to be coincidence;
    ///   3. exactly one shared meaningful word AND it is the only meaningful
    ///      word on at least one side, so that side's whole identity is the
    ///      shared word ("Razzmatazz" ~ "Razzmatazz sales 2 & 3").
    ///
    /// Rule 3 is the loosest, and the old matcher applied it to every word —
    /// hence "Azul Rooftop Barceloneta" matching "Azimuth Rooftop Bar" on
    /// "rooftop" alone.
    static func matches(_ a: String, _ b: String) -> Bool {
        let na = normalized(a), nb = normalized(b)
        if na.isEmpty || nb.isEmpty { return false }
        if na == nb { return true }

        // Deduped: a name that repeats a word ("Bling Bling") still has a
        // single word's worth of identity, so the counts must not double it.
        let wa = Set(meaningfulWords(a)), wb = Set(meaningfulWords(b))
        if wa.isEmpty || wb.isEmpty { return false }

        let shared = wa.intersection(wb)

        if shared.count >= 2 { return true }
        if shared.count == 1 { return wa.count == 1 || wb.count == 1 }
        return false
    }

    /// Mirrors src/lib/venue-match.test.ts — keep the two lists identical.
    static func runSelfChecks() {
        // Exact / normalisation
        assert(matches("Razzmatazz", "Razzmatazz"))
        assert(matches("Macarena Club", "Macarena Club"))
        assert(matches("Sala Apolo", "sala  apolo!"))
        assert(matches("Montjuïc", "Montjuic"))            // diacritics folded
        assert(!matches("", "Razzmatazz"))
        assert(!matches("Razzmatazz", ""))

        // Rule 2 — two shared meaningful words
        assert(matches("Otto Zutz Barcelona", "Otto Zutz Club"))
        assert(matches("Sala Apolo Nitsa", "Apolo Nitsa Club"))

        // Rule 3 — one shared word that is a whole side's identity.
        // ("City Hall" reduces to ["hall"]: "city" is a corpus stopword.)
        assert(matches("City Hall", "Disco City Hall"))
        assert(matches("Razzmatazz", "Razzmatazz sales 2 & 3"))
        assert(matches("Input", "Input High Fidelity Dance Club"))
        assert(matches("Opium", "Opium Barcelona Restaurant"))
        assert(matches("Apolo", "Sala Apolo"))
        assert(matches("Sala Apolo", "Apolo"))              // symmetric
        assert(matches("Moog", "Moog Bar"))
        assert(matches("TBA - Backstage - Carrer Casp, 33", "Backstage"))
        // A repeated word counts once
        assert(matches("Bling Bling Barcelona", "Bling Bling Nightclub"))

        // The regression this rewrite exists for: generic words must not match
        assert(!matches("Azul Rooftop Barceloneta", "Skygarden Barcelona Rooftop"))
        assert(!matches("Azul Rooftop Barceloneta", "Azimuth Rooftop Bar"))
        assert(!matches("Almar Beach Club", "El Kabron Beach Club"))
        assert(!matches("Casa Montjuïc", "Casa Amirall"))
        assert(!matches("City Hall", "Bar Hot Dog City"))
        assert(!matches("Hola Club Sitges (Cala Vallcarca)", "La Cala"))
        assert(!matches("Azul Rooftop Barceloneta", "Lolita Barceloneta"))
        assert(!matches("Garage 442", "Garage Beer Co"))
        assert(!matches("Teatre Grec", "Bar Teatre"))
        assert(!matches("TBA - Backstage - Carrer Casp, 33", "El 9 Carrer"))
        assert(!matches("Parc Nou. El Prat de Llobregat", "Bar Llobregat"))
        assert(!matches("Sunseabar Beach Club", "Go Beach Club Barcelona"))
        assert(!matches("Azul Rooftop Barceloneta", "Azul Frida"))

        // One shared word, but neither side reduces to it alone
        assert(!matches("Sutton Barcelona Lisboa", "Sutton Madrid Porto"))

        // Names made only of stopwords match exactly or not at all
        assert(matches("Beach Club", "beach club"))
        assert(!matches("Beach Club", "Rooftop Bar"))
    }
}
