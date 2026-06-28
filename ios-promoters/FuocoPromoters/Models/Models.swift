import Foundation

struct PromoterProfile: Codable, Equatable {
    let id: UUID
    let email: String?
    let fullName: String?
    let isPromoter: Bool
    var accountKind: String = "user"   // 'user' | 'promoter'

    var displayName: String {
        if let n = fullName?.split(separator: " ").first, !n.isEmpty { return String(n) }
        return email?.split(separator: "@").first.map(String.init) ?? "you"
    }
}

struct Club: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let name: String
}

struct PromoterNight: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let clubId: UUID?
    let title: String?
    let nightDate: String   // yyyy-MM-dd
    let doorsAt: Date?
    let openTime: String?   // "HH:mm:ss"
    let closeTime: String?  // "HH:mm:ss"
    let totalCapacity: Int
    let isPublished: Bool
    let locationName: String?
    let address: String?
    let lat: Double?
    let lng: Double?
    let autoCheckin: Bool?
    let description: String?
    let theme: String?
    let photoUrls: [String]?
    let maxPlusOnes: Int?
    var club: Club?

    /// Venue label — club name for partner clubs, custom name otherwise.
    var venueName: String { club?.name ?? locationName ?? "Custom location" }
    var displayTitle: String { title ?? venueName }
}

/// Sentinel capacity meaning "unlimited" — stored in spots since the column
/// is a non-null int. Anything at/above the threshold reads as unlimited.
enum SpotsLimit {
    static let unlimited = 1_000_000
    static let threshold = 100_000
}

struct GuestCountRow: Codable, Equatable, Hashable {
    let id: UUID
    let plusOnes: Int
    let checkedInAt: Date?
}

struct PromoterAllocation: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let nightId: UUID
    let promoterId: UUID
    let spots: Int
    let payoutPerGuest: Decimal
    let payoutStatus: String
    let groupVisible: Bool?
    let inviteToken: String?
    var night: PromoterNight?
    var guests: [GuestCountRow]?

    var guestCount: Int { (guests ?? []).reduce(0) { $0 + 1 + $1.plusOnes } }
    var checkedInCount: Int {
        (guests ?? []).filter { $0.checkedInAt != nil }.reduce(0) { $0 + 1 + $1.plusOnes }
    }
    var earnings: Decimal { payoutPerGuest * Decimal(guestCount) }
    var isUnlimited: Bool { spots >= SpotsLimit.threshold }
    /// "12 / 25" or "12 / ∞" for the used-capacity displays.
    var usedLabel: String { "\(guestCount) / \(isUnlimited ? "∞" : "\(spots)")" }
}

struct PromoterGuest: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let allocationId: UUID
    let fullName: String
    let plusOnes: Int
    let note: String?
    let checkedInAt: Date?
    let createdAt: Date?
    let referralId: UUID?

    var totalCount: Int { 1 + plusOnes }
    var isCheckedIn: Bool { checkedInAt != nil }
}

struct PromoterReferral: Codable, Identifiable, Equatable, Hashable, Sendable {
    let id: UUID
    let label: String
    let token: String
}

struct NewGuest: Encodable {
    let allocationId: UUID
    let fullName: String
    let plusOnes: Int
    let note: String?
}

struct PromoterProfileRow: Codable, Equatable, Hashable, Sendable {
    let userId: UUID
    let brandName: String?
    let logoUrl: String?
    let bio: String?
    let instagram: String?
}

struct PromoterApplication: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let userId: UUID
    let instagram: String?
    let clubs: String?
    let experience: String?
    let status: String        // pending | approved | rejected
    let igCode: String?
    let igVerified: Bool?
    let createdAt: Date?
}

struct PromoterSeries: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let clubId: UUID?
    let title: String?
    let weekdays: [Int]        // 1=Sun … 7=Sat
    let openTime: String?
    let closeTime: String?
    let spots: Int
    let payoutPerGuest: Decimal
    let groupVisible: Bool
    let inviteToken: String
    let isActive: Bool
    let locationName: String?
    let address: String?
    let lat: Double?
    let lng: Double?
    let autoCheckin: Bool?
    let description: String?
    let theme: String?
    let photoUrls: [String]?
    let maxPlusOnes: Int?
    var club: Club?

    /// "Every Fri", "Every Fri & Sat", etc.
    var weekdayLabel: String {
        let names = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        let picked = weekdays.sorted().compactMap { (1...7).contains($0) ? names[$0] : nil }
        if picked.isEmpty { return "Recurring" }
        return "Every " + picked.joined(separator: " & ")
    }
    var venueName: String { club?.name ?? locationName ?? "Custom location" }
    var displayTitle: String { title ?? venueName }
}
