import Foundation

/// A DJ surfaced on a club page in place of a real event — the "this slot is a
/// DJ set, not an event" case. Flattens a `club_dj_sets` row joined to its `djs`
/// catalogue row (see supabase/migrations/djs.sql).
struct FeaturedDJ: Decodable, Identifiable, Sendable, Hashable {
    let raArtistId: String
    let name: String
    let genres: [String]
    let instagram: String?
    let soundcloud: String?
    let website: String?
    let knownVenues: [String]
    let regions: [String]
    let bio: String?
    let raUrl: String?
    let imageUrl: String?
    let coverImageUrl: String?
    let raFollowers: Int?

    // From the club_dj_sets slot (curated, optional):
    let residencyLabel: String?
    let night: String?

    var id: String { raArtistId }

    /// A DJ not in our RA catalogue — surfaced from a single-DJ night by name
    /// only (synthetic "guest:" id). Rendered as a "Special guest".
    var isGuest: Bool { raArtistId.hasPrefix("guest:") }

    /// "Barcelona, ES"-style origin from the most-played region, when present.
    var origin: String? {
        guard let first = regions.first, !first.isEmpty else { return nil }
        return first
    }

    /// "Resident · Saturdays" — only the parts we actually have.
    var residencyLine: String? {
        let parts = [residencyLabel, night].compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                                           .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Build one from a plain `djs` catalogue row — used when opening a DJ page
    /// from an event's lineup, where there's no club_dj_sets residency slot (so
    /// `residencyLabel`/`night` are nil and the "WHEN THEY PLAY HERE" line is
    /// simply hidden).
    init(raArtistId: String, name: String, genres: [String], instagram: String?,
         soundcloud: String?, website: String?, knownVenues: [String], regions: [String],
         bio: String?, raUrl: String?, imageUrl: String?, coverImageUrl: String?,
         raFollowers: Int?, residencyLabel: String? = nil, night: String? = nil) {
        self.raArtistId = raArtistId; self.name = name; self.genres = genres
        self.instagram = instagram; self.soundcloud = soundcloud; self.website = website
        self.knownVenues = knownVenues; self.regions = regions; self.bio = bio
        self.raUrl = raUrl; self.imageUrl = imageUrl; self.coverImageUrl = coverImageUrl
        self.raFollowers = raFollowers; self.residencyLabel = residencyLabel; self.night = night
    }

    // The nested-join row PostgREST returns: slot fields at top level, dj embedded.
    private enum CodingKeys: String, CodingKey {
        case residencyLabel, night, dj
    }
    private enum DJKeys: String, CodingKey {
        case raArtistId, name, genres, instagram, soundcloud, website
        case knownVenues, regions, bio, raUrl, imageUrl, coverImageUrl, raFollowers
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        residencyLabel = try c.decodeIfPresent(String.self, forKey: .residencyLabel)
        night = try c.decodeIfPresent(String.self, forKey: .night)

        let dj = try c.nestedContainer(keyedBy: DJKeys.self, forKey: .dj)
        raArtistId    = try dj.decode(String.self, forKey: .raArtistId)
        name          = try dj.decode(String.self, forKey: .name)
        genres        = try dj.decodeIfPresent([String].self, forKey: .genres) ?? []
        instagram     = try dj.decodeIfPresent(String.self, forKey: .instagram)
        soundcloud    = try dj.decodeIfPresent(String.self, forKey: .soundcloud)
        website       = try dj.decodeIfPresent(String.self, forKey: .website)
        knownVenues   = try dj.decodeIfPresent([String].self, forKey: .knownVenues) ?? []
        regions       = try dj.decodeIfPresent([String].self, forKey: .regions) ?? []
        bio           = try dj.decodeIfPresent(String.self, forKey: .bio)
        raUrl         = try dj.decodeIfPresent(String.self, forKey: .raUrl)
        imageUrl      = try dj.decodeIfPresent(String.self, forKey: .imageUrl)
        coverImageUrl = try dj.decodeIfPresent(String.self, forKey: .coverImageUrl)
        raFollowers   = try dj.decodeIfPresent(Int.self, forKey: .raFollowers)
    }
}

/// One dated appearance for a DJ — an `events` row whose `artists` array
/// includes them and whose date is today or later. This is the DJ's real
/// "where they're scheduled to be", across every venue (not only this club):
/// the very rows the DJ pages were built from carry the date, so we surface it
/// ourselves rather than sending the user to Resident Advisor.
///
/// Field names are camelCase to match SupabaseService's snake_case decoding
/// (start_time → startTime, venue_name → venueName, club_id → clubId).
struct DJGig: Decodable, Identifiable, Sendable, Hashable {
    let date: String            // "yyyy-MM-dd"
    let startTime: String?
    let venueName: String?
    let clubId: String?         // our clubs.id when the venue was matched at ingest
    let raUrl: String?

    var id: String { "\(date)|\(venueName ?? "?")" }

    /// "Wed 13 Aug", or the raw string if it somehow doesn't parse.
    var displayDate: String {
        guard let d = DJGig.iso.date(from: date) else { return date }
        return DJGig.pretty.string(from: d)
    }

    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        return f
    }()
    private static let pretty: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEE d MMM"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        return f
    }()
}
