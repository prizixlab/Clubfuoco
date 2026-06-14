import Foundation

/// PostgREST embeds a to-one relation as an object but returns an array when
/// the relationship is declared one-to-many. The clubs route reads
/// `live_status` as an object — accept both shapes so a schema nuance can't
/// break feed decoding.
struct EmbeddedOne<T: Decodable & Sendable>: Decodable, Sendable {
    let value: T?

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = nil
        } else if let one = try? container.decode(T.self) {
            value = one
        } else {
            value = try container.decode([T].self).first
        }
    }
}

extension EmbeddedOne: Equatable where T: Equatable {}
extension EmbeddedOne: Hashable where T: Hashable {}

/// Shape returned by GET /api/clubs (see src/app/api/clubs/route.ts).
struct Club: Decodable, Identifiable, Sendable {
    let id: UUID
    let name: String
    let slug: String?
    let description: String?
    let address: String?
    let neighborhood: String?
    let lat: Double?
    let lng: Double?
    let coverImageUrl: String?
    let musicGenres: [String]?
    let generalEntryPrice: Double?
    let vipTableMinSpend: Double?
    let instagramHandle: String?
    let isFeatured: Bool?
    private let liveStatus: EmbeddedOne<LiveStatus>?

    var live: LiveStatus? { liveStatus?.value }
}

struct LiveStatus: Decodable, Sendable {
    let crowdPercentage: Int?
    let crowdLabel: String?
    let currentDj: String?
    let isOpen: Bool?
    let queueWaitMinutes: Int?
    let updatedAt: String?
}
