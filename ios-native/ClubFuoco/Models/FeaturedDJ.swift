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
