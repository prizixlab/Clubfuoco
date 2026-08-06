import Foundation

// MARK: - Access Descriptor (server → app, §2 of the plan)
// One uniform shape for every credential kind. The app never needs to know
// which table a QR came from — the resolve endpoint normalises it.

enum CredentialKind: String, Codable {
    case paidEntry = "paid_entry"
    case vipTable = "vip_table"
    case guestlist
    case ticket
    case membership

    var label: String {
        switch self {
        case .paidEntry:  return "Paid entry"
        case .vipTable:   return "VIP table"
        case .guestlist:  return "Guestlist"
        case .ticket:     return "Ticket"
        case .membership: return "Membership"
        }
    }
    var icon: String {
        switch self {
        case .paidEntry:  return "ticket.fill"
        case .vipTable:   return "star.fill"
        case .guestlist:  return "person.2.fill"
        case .ticket:     return "ticket"
        case .membership: return "crown.fill"
        }
    }
}

enum AccessStatus: String, Codable {
    case ok
    case alreadyUsed = "already_used"
    case over
    case cancelled
    case invalid
    case wrongNight = "wrong_night"
    /// The ticket is valid, but for a different club than this door works.
    case wrongVenue = "wrong_venue"

    /// Free guestlist is excluded from overscan billing, but the door still
    /// counts heads. `over` on a guestlist is informational, not a charge.
    var admits: Bool { self == .ok || self == .over }
}

struct Entitlement: Codable, Hashable {
    var label: String
    /// The headline count for this credential — party size / plus-ones / qty.
    var count: Int
    var extras: [String]
}

struct Allowance: Codable, Hashable {
    var used: Int
    var allowed: Int
    var remaining: Int { max(0, allowed - used) }
}

struct AccessDescriptor: Codable, Identifiable, Hashable {
    var id: String { tokenRef }
    var holderName: String
    var holderAvatarUrl: String?
    var kind: CredentialKind
    var entitlement: Entitlement
    var allowance: Allowance
    var status: AccessStatus
    var venue: String
    /// Human-readable club, so a rejected ticket can say WHICH venue it's for.
    var venueName: String?
    var night: String            // ISO date "2026-08-05"
    var tokenRef: String         // what a later void refers to
}

// MARK: - Night manifest (server → app, cached locally, §4)
// The signed set of every valid token for a venue/night. Enables offline scans.

struct NightManifest: Codable {
    var venue: String
    var venueName: String
    var night: String
    var issuedAt: Date
    var serverTime: Date
    var entries: [ManifestEntry]
    var signature: String        // server-signed; app rejects tampered caches
}

struct ManifestEntry: Codable, Hashable {
    var tokenRef: String
    var payloadKeys: [String]    // raw QR payloads that resolve to this entry
    var holderName: String
    var holderAvatarUrl: String?
    var kind: CredentialKind
    var entitlement: Entitlement
    var allowed: Int
    var used: Int?               // server's cross-door count baseline (nil in mock)
    var billable: Bool           // false for free guestlist (overscan-excluded)
}

// MARK: - Admission / void queue (local, append-only, §3 & §4)

enum ScanAction: String, Codable {
    case admit
    case void
}

/// One append-only record. `scanId` is the client idempotency key the server
/// dedupes on. Survives app kill; pruned only after the server acks it.
struct QueuedScan: Codable, Identifiable, Hashable {
    var scanId: UUID
    var id: UUID { scanId }
    var action: ScanAction
    var tokenRef: String
    var count: Int               // heads admitted (or voided) in this record
    var deviceTime: Date         // monotonic-ish device timestamp
    var holderName: String       // denormalised for the recent-scans list
    var kind: CredentialKind
    var reason: String?          // optional void reason
    var synced: Bool = false     // flipped once the server acks
}
