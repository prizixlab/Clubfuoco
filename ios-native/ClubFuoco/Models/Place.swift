import Foundation

/// Feed venue model — native mirror of the `Place` shape getNearbyClubs()
/// produces in src/lib/supabase/queries.ts (a mapped `clubs` row).
struct Place: Identifiable, Sendable, Hashable {
    let placeId: String
    let name: String
    let slug: String?
    let address: String
    let neighborhood: String?
    let lat: Double
    let lng: Double
    let rating: Double?
    let ratingsTotal: Int
    let priceLevel: Int?
    let isOpen: Bool?
    let weekdayHours: [String]
    let musicGenres: [String]
    let tags: [String]
    let googlePlaceId: String?
    let isFeatured: Bool
    let isPartner: Bool
    let generalEntryPrice: Double?
    let vipTableMinSpend: Double?
    let coverPhoto: String?
    let photos: [String]
    var distance: Double?

    var id: String { placeId }

    static let priceLabels = ["Free", "€", "€€", "€€€", "€€€€"]

    /// Keyword match against name + tags + genres (anyHas() on web).
    func matches(_ keywords: [String]) -> Bool {
        let haystack = ([name] + tags + musicGenres).joined(separator: " ").lowercased()
        return keywords.contains { haystack.contains($0) }
    }

    var mapsURL: URL? {
        if let googlePlaceId {
            return URL(string: "https://www.google.com/maps/place/?q=place_id:\(googlePlaceId)")
        }
        let q = (name + " Barcelona").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "https://www.google.com/maps/search/?api=1&query=\(q)")
    }
}

/// Decodes either a JSON array of strings or a single string (the
/// `opening_hours` column varies — toHoursArray() on web).
struct FlexibleStringArray: Decodable, Sendable, Hashable {
    let values: [String]

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let array = try? container.decode([String].self) {
            values = array
        } else if let string = try? container.decode(String.self) {
            if let data = string.data(using: .utf8),
               let parsed = try? JSONDecoder().decode([String].self, from: data) {
                values = parsed
            } else {
                values = string.isEmpty ? [] : [string]
            }
        } else {
            values = []
        }
    }
}

/// Raw `clubs` row from the nearby-clubs PostgREST select.
struct NearbyClubRow: Decodable, Sendable {
    struct Tag: Decodable, Sendable {
        let tag: String
        let category: String?
    }

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
    let generalEntryPrice: Double?
    let vipTableMinSpend: Double?
    let openingHours: FlexibleStringArray?
    let isFeatured: Bool?
    let isPartner: Bool?
    let liveStatus: EmbeddedOne<LiveStatus>?
    let clubTags: [Tag]?

    /// Mirrors the getNearbyClubs() mapping: photo filtering (only self-hosted
    /// imagery counts — Google Places URLs render broken), dedupe, cap at 8.
    func toPlace() -> Place {
        var seen = Set<String>()
        let allPhotos = ([coverImageUrl].compactMap { $0 } + (photos ?? []) + (galleryUrls ?? []))
            .filter { url in
                !url.isEmpty
                    && !url.contains("maps.googleapis.com/maps/api/place/photo")
                    && !url.contains("/api/places/photo")
            }
            .filter { seen.insert($0).inserted }
            .prefix(8)

        return Place(
            placeId: id.uuidString.lowercased(),
            name: name,
            slug: slug,
            address: address ?? "",
            neighborhood: neighborhood,
            lat: lat ?? 0,
            lng: lng ?? 0,
            rating: rating,
            ratingsTotal: ratingsTotal ?? 0,
            priceLevel: nil,
            isOpen: liveStatus?.value?.isOpen,
            weekdayHours: openingHours?.values ?? [],
            musicGenres: musicGenres ?? [],
            tags: (clubTags ?? []).map(\.tag),
            googlePlaceId: googlePlaceId,
            isFeatured: isFeatured ?? false,
            isPartner: isPartner ?? false,
            generalEntryPrice: generalEntryPrice,
            vipTableMinSpend: vipTableMinSpend,
            coverPhoto: allPhotos.first,
            photos: Array(allPhotos),
            distance: nil
        )
    }
}

/// Saved venue row (place_favorites table).
struct PlaceFavorite: Decodable, Sendable {
    let placeId: String
}

// ── Opening-hours helpers (port of src/lib/hours.ts) ──────────────────────────

enum Hours {
    /// "5:00 PM" / "18:00" → minutes from midnight, or nil.
    private static func parseClock(_ s: String) -> Int? {
        let t = s.trimmingCharacters(in: .whitespaces)

        if let match = t.range(of: #"^(\d{1,2}):?(\d{2})?\s*(AM|PM)$"#, options: [.regularExpression, .caseInsensitive]) {
            let str = String(t[match])
            let digits = str.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
            guard var h = digits.first else { return nil }
            let min = digits.count > 1 ? digits[1] : 0
            let isPM = str.uppercased().contains("PM")
            if isPM && h != 12 { h += 12 }
            if !isPM && h == 12 { h = 0 }
            return h * 60 + min
        }

        let parts = t.split(separator: ":")
        if parts.count == 2, let h = Int(parts[0]), let min = Int(parts[1]), h <= 24, min < 60 {
            return (h % 24) * 60 + min
        }
        return nil
    }

    /// "Monday: 6:00 PM – 3:00 AM" → [(open, close)] minutes. Handles multiple
    /// comma-separated ranges (e.g. "5:30 – 11:30 PM, 11:59 PM – 6:00 AM");
    /// empty when closed / unparseable.
    static func parseRanges(_ row: String?) -> [(open: Int, close: Int)] {
        guard let row else { return [] }
        let hrs: String
        if let colon = row.firstIndex(of: ":") {
            hrs = String(row[row.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        } else {
            hrs = row
        }
        if hrs.range(of: "closed", options: .caseInsensitive) != nil { return [] }
        return hrs.components(separatedBy: ",").compactMap { segment in
            let parts = segment.components(separatedBy: CharacterSet(charactersIn: "–—-"))
                .flatMap { $0.components(separatedBy: " to ") }
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            guard parts.count == 2,
                  let o = parseClock(parts[0]),
                  let c = parseClock(parts[1]) else { return nil }
            return (open: o, close: c)
        }
    }

    /// Open right now, from the weekly hours (handles cross-midnight ranges).
    /// nil when hours are unknown. Port of computeOpenNow() in src/lib/hours.ts.
    static func computeOpenNow(_ rows: [String]) -> Bool? {
        guard rows.count >= 7 else { return nil }
        let now = Date()
        let cal = Calendar.current
        let nowMin = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
        let todayIdx = (cal.component(.weekday, from: now) + 5) % 7  // Mon=0 … Sun=6
        let yIdx = (todayIdx + 6) % 7

        for today in parseRanges(rows[todayIdx]) {
            if today.close >= today.open {
                if nowMin >= today.open && nowMin < today.close { return true }
            } else if nowMin >= today.open {
                return true  // cross-midnight: open until close tomorrow
            }
        }
        // Yesterday's range that wraps past midnight into today
        for y in parseRanges(rows[yIdx]) where y.close < y.open {
            if nowMin < y.close { return true }
        }
        return false
    }

    /// Opening→closing window for the NIGHT of `date`. Picks the first evening/
    /// late range on that weekday. Falls back to 17:00 → 03:00 (next day) when
    /// hours are unknown — these defaults bound the attendance check-in window.
    static func nightWindow(for date: String, hours: [String]) -> (openMin: Int, closeMin: Int, closesNextDay: Bool) {
        let fallback = (openMin: 17 * 60, closeMin: 3 * 60, closesNextDay: true)
        guard hours.count >= 7 else { return fallback }
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let d = fmt.date(from: date) else { return fallback }
        let weekday = Calendar.current.component(.weekday, from: d)
        let idx = (weekday + 5) % 7
        let ranges = parseRanges(hours[idx])
        guard let r = ranges.first(where: { $0.open >= 18 * 60 || $0.close < $0.open || $0.close >= 22 * 60 })
              ?? ranges.first else { return fallback }
        return (openMin: r.open, closeMin: r.close, closesNextDay: r.close < r.open)
    }

    /// Open for the NIGHT of `date` (YYYY-MM-DD): evening hours, cross-midnight,
    /// or closes 22:00+. nil when hours are unknown.
    static func isOpenOnDate(_ rows: [String], date: String) -> Bool? {
        guard rows.count >= 7 else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let d = formatter.date(from: date) else { return nil }
        let weekday = Calendar.current.component(.weekday, from: d) // Sun=1
        let idx = (weekday + 5) % 7                                  // Mon=0 … Sun=6

        let ranges = parseRanges(rows[idx])
        if ranges.isEmpty { return false }
        // Open for the night if ANY range qualifies as evening/late.
        return ranges.contains { range in
            let opensEvening = range.open >= 18 * 60
            let crossesMidnight = range.close < range.open
            let closesLate = range.close >= 22 * 60
            return opensEvening || crossesMidnight || closesLate
        }
    }
}
