import Foundation

struct PromoterProfile: Codable, Equatable {
    let id: UUID
    let email: String?
    let fullName: String?
    let isPromoter: Bool

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
    let clubId: UUID
    let title: String?
    let nightDate: String   // yyyy-MM-dd
    let doorsAt: Date?
    let openTime: String?   // "HH:mm:ss"
    let closeTime: String?  // "HH:mm:ss"
    let totalCapacity: Int
    let isPublished: Bool
    var club: Club?

    var displayTitle: String { title ?? club?.name ?? "Night" }
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
}

struct PromoterGuest: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let allocationId: UUID
    let fullName: String
    let plusOnes: Int
    let note: String?
    let checkedInAt: Date?
    let createdAt: Date?

    var totalCount: Int { 1 + plusOnes }
    var isCheckedIn: Bool { checkedInAt != nil }
}

struct NewGuest: Encodable {
    let allocationId: UUID
    let fullName: String
    let plusOnes: Int
    let note: String?
}

struct PromoterApplication: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let userId: UUID
    let instagram: String?
    let clubs: String?
    let experience: String?
    let status: String        // pending | approved | rejected
    let createdAt: Date?
}

struct PromoterSeries: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    let clubId: UUID
    let title: String?
    let weekdays: [Int]        // 1=Sun … 7=Sat
    let openTime: String?
    let closeTime: String?
    let spots: Int
    let payoutPerGuest: Decimal
    let groupVisible: Bool
    let inviteToken: String
    let isActive: Bool
    var club: Club?

    /// "Every Fri", "Every Fri & Sat", etc.
    var weekdayLabel: String {
        let names = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        let picked = weekdays.sorted().compactMap { (1...7).contains($0) ? names[$0] : nil }
        if picked.isEmpty { return "Recurring" }
        return "Every " + picked.joined(separator: " & ")
    }
    var displayTitle: String { title ?? club?.name ?? "Recurring night" }
}
