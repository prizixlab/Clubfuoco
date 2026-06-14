import Foundation

// ── Friends (GET /api/friends, /api/friends/search) ──────────────────────────

struct FriendUser: Decodable, Identifiable, Sendable, Hashable {
    let id: UUID
    let fullName: String?
    let avatarUrl: String?
    let friendshipId: UUID

    var initials: String {
        let parts = (fullName ?? "").split(separator: " ")
        let chars = parts.prefix(2).compactMap { $0.first.map(String.init) }
        return chars.isEmpty ? "?" : chars.joined().uppercased()
    }
}

struct FriendsData: Decodable, Sendable {
    let friends: [FriendUser]
    let incoming: [FriendUser]
    let outgoing: [FriendUser]
}

struct FriendSearchResult: Decodable, Identifiable, Sendable {
    let id: UUID
    let fullName: String?
    let avatarUrl: String?
    let relation: String        // none | friends | outgoing | incoming
    let friendshipId: UUID?

    var initials: String {
        let parts = (fullName ?? "").split(separator: " ")
        let chars = parts.prefix(2).compactMap { $0.first.map(String.init) }
        return chars.isEmpty ? "?" : chars.joined().uppercased()
    }
}

// ── Groups (GET /api/groups, /api/groups/[id]) ────────────────────────────────

struct GroupListItem: Decodable, Identifiable, Sendable, Hashable {
    struct ClubInfo: Decodable, Sendable, Hashable {
        let name: String?
        let coverImageUrl: String?
    }

    let id: UUID
    let bookingType: String
    let bookingDate: String
    let status: String
    let inviteCode: String?
    let clubs: EmbeddedOne<ClubInfo>?
    let myRsvp: String?

    var club: ClubInfo? { clubs?.value }
}

struct GroupMember: Decodable, Identifiable, Sendable {
    let id: UUID
    let userId: UUID
    let fullName: String?
    let avatarUrl: String?
    let role: String            // organizer | member
    let rsvp: String            // invited | going | maybe | declined
    let paymentRequired: Bool
    let amountDue: Double?
    let charge: Double
    let paid: Bool
    let isMe: Bool
    let bookingId: UUID?        // this member's own entry booking (only set for me)
    let qrToken: String?        // their pass QR (only set for me — never others')

    var initials: String {
        let parts = (fullName ?? "").split(separator: " ")
        let chars = parts.prefix(2).compactMap { $0.first.map(String.init) }
        return chars.isEmpty ? "?" : chars.joined().uppercased()
    }
}

struct GroupDetail: Decodable, Sendable {
    let id: UUID
    let clubId: UUID
    let clubName: String
    let clubImage: String?
    let organizerId: UUID
    let organizerName: String?
    let bookingType: String
    let bookingDate: String
    let inviteCode: String
    let status: String
    let unitPrice: Double
    let members: [GroupMember]
    let me: GroupMember?
}

struct GroupJoinResult: Decodable, Sendable {
    let rsvp: String
    let bookingId: UUID?
    let qrToken: String?
}

// ── Rumbas (GET /api/rumbas, signups) ─────────────────────────────────────────

struct Rumba: Decodable, Identifiable, Sendable, Hashable {
    let id: UUID
    let title: String
    let venueName: String?
    let venuePlaceId: String?
    let eventDate: String?      // timestamp string
    let capacity: Int?
    let description: String?
    let coverImage: String?
    let dressCode: String?
    let signupCount: Int?

    var spotsLeft: Int {
        max(0, (capacity ?? 0) - (signupCount ?? 0))
    }
}

struct RumbaSignup: Decodable, Sendable {
    let id: UUID
    let status: String?         // confirmed | waitlist | denied …
    let plusOnes: Int?
    let name: String?
}

// ── Fiamme (GET /api/fiamme) ──────────────────────────────────────────────────

struct FiammeData: Decodable, Sendable {
    struct Activity: Decodable, Identifiable, Sendable {
        let id: UUID
        let amount: Int
        let type: String?
        let description: String?
        let createdAt: String?
    }

    let balance: Int
    let reviewCount: Int
    let activity: [Activity]
}

struct FiammeRedeemResult: Decodable, Sendable {
    let code: String
}

/// Fixed reward catalogue (mirrors /api/fiamme/redeem REWARDS).
struct FiammeReward: Identifiable {
    let key: String
    let cost: Int
    var id: String { key }

    static let all: [FiammeReward] = [
        FiammeReward(key: "comp_drink", cost: 100),
        FiammeReward(key: "skip_line", cost: 250),
        FiammeReward(key: "free_cover", cost: 500),
        FiammeReward(key: "bottle_deposit", cost: 1000),
    ]
}

/// Fiamme tier ladder (mirrors TIERS in fiamme/page.tsx; thresholds = reviews).
struct FiammeTier {
    let key: String
    let label: String           // brand (Italian) name
    let min: Int
    let mult: String

    static let all: [FiammeTier] = [
        FiammeTier(key: "nuovo", label: "Nuovo", min: 0, mult: "1×"),
        FiammeTier(key: "regolare", label: "Regolare", min: 5, mult: "1.2×"),
        FiammeTier(key: "conoscitore", label: "Conoscitore", min: 15, mult: "1.5×"),
        FiammeTier(key: "tastemaker", label: "Tastemaker", min: 30, mult: "2×"),
    ]

    static func current(reviews: Int) -> FiammeTier {
        all.last { reviews >= $0.min } ?? all[0]
    }
}

// ── Notifications (GET /api/notifications) ────────────────────────────────────

struct NotificationItem: Decodable, Identifiable, Sendable {
    let id: UUID
    let type: String?
    let title: String
    let body: String?
    let link: String?
    let isRead: Bool?
    let createdAt: String?
}
