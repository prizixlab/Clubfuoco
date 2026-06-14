import Foundation

/// Venue detail — the richer shape getClubById() returns (description,
/// socials, full live status, all photos).
struct PlaceDetail: Sendable {
    let placeId: String
    let name: String
    let address: String
    let neighborhood: String?
    let description: String?
    let instagramHandle: String?
    let whatsappLink: String?
    let rating: Double?
    let ratingsTotal: Int
    let live: LiveStatus?
    let weekdayHours: [String]
    let musicGenres: [String]
    let tags: [String]
    let googlePlaceId: String?
    let isPartner: Bool
    let isFeatured: Bool
    let generalEntryPrice: Double?
    let vipTableMinSpend: Double?
    let photos: [String]

    var isOpen: Bool? { live?.isOpen }

    var mapsURL: URL? {
        if let googlePlaceId {
            return URL(string: "https://www.google.com/maps/place/?q=place_id:\(googlePlaceId)")
        }
        let q = (name + " Barcelona").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "https://www.google.com/maps/search/?api=1&query=\(q)")
    }

    var instagramURL: URL? {
        guard let instagramHandle, !instagramHandle.isEmpty else { return nil }
        let handle = instagramHandle.hasPrefix("@") ? String(instagramHandle.dropFirst()) : instagramHandle
        return URL(string: "https://instagram.com/\(handle)")
    }
}

struct PlaceDetailRow: Decodable, Sendable {
    let id: UUID
    let name: String
    let slug: String?
    let address: String?
    let neighborhood: String?
    let lat: Double?
    let lng: Double?
    let coverImageUrl: String?
    let galleryUrls: [String]?
    let photos: [String]?
    let rating: Double?
    let ratingsTotal: Int?
    let musicGenres: [String]?
    let googlePlaceId: String?
    let description: String?
    let instagramHandle: String?
    let whatsappLink: String?
    let generalEntryPrice: Double?
    let vipTableMinSpend: Double?
    let openingHours: FlexibleStringArray?
    let isFeatured: Bool?
    let isPartner: Bool?
    let liveStatus: EmbeddedOne<LiveStatus>?
    let clubTags: [NearbyClubRow.Tag]?

    func toDetail() -> PlaceDetail {
        var seen = Set<String>()
        let allPhotos = ([coverImageUrl].compactMap { $0 } + (photos ?? []) + (galleryUrls ?? []))
            .filter { url in
                !url.isEmpty
                    && !url.contains("maps.googleapis.com/maps/api/place/photo")
                    && !url.contains("/api/places/photo")
            }
            .filter { seen.insert($0).inserted }

        return PlaceDetail(
            placeId: id.uuidString.lowercased(),
            name: name,
            address: address ?? "",
            neighborhood: neighborhood,
            description: description,
            instagramHandle: instagramHandle,
            whatsappLink: whatsappLink,
            rating: rating,
            ratingsTotal: ratingsTotal ?? 0,
            live: liveStatus?.value,
            weekdayHours: openingHours?.values ?? [],
            musicGenres: musicGenres ?? [],
            tags: (clubTags ?? []).map(\.tag),
            googlePlaceId: googlePlaceId,
            isPartner: isPartner ?? false,
            isFeatured: isFeatured ?? false,
            generalEntryPrice: generalEntryPrice,
            vipTableMinSpend: vipTableMinSpend,
            photos: Array(allPhotos)
        )
    }
}
