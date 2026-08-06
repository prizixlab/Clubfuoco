import Foundation

// MARK: - Server contract (§5 of the plan)
// The real endpoints (POST /api/door/enroll|manifest|scan|void|sync) do not
// exist yet — this protocol IS the contract they'll implement. Swap MockDoorRepo
// for DoorAPIRepo once the server is live; nothing above this layer changes.

struct EnrollResult: Codable {
    var deviceToken: String
    var venue: String
    var venueName: String
}

struct SyncResult: Codable {
    var acceptedScanIds: [UUID]
    var rejectedScanIds: [UUID]     // e.g. allowance exceeded by another door
    var manifest: NightManifest
}

protocol DoorRepo {
    /// Enroll this physical device to a venue with a revocable credential.
    func enroll(code: String) async throws -> EnrollResult
    /// Live per-scan resolution of a scanned QR payload (open-access path).
    func resolve(_ payload: String) async throws -> AccessDescriptor
    /// Record one admission/void immediately (open-access path). Idempotent on
    /// scanId, so a retry can't double-count.
    func record(_ scan: QueuedScan) async throws
    /// Venues. nil date → every active club (the "which venue do you work?"
    /// picker); a date → only venues with something on that night.
    func venues(date: String?) async throws -> [DoorVenue]
    /// The encrypted night pack — every entry sealed with that guest's own QR.
    func nightPack(venue: String, date: String) async throws -> EncryptedManifest
    /// Pull the signed night manifest for a venue/date.
    func fetchManifest(venue: String, date: String, deviceToken: String) async throws -> NightManifest
    /// Bulk push queued scans/voids, pull a fresh manifest + server time.
    func sync(scans: [QueuedScan], venue: String, date: String, deviceToken: String) async throws -> SyncResult
}

enum DoorRepoError: LocalizedError {
    case badCode
    case offline
    case tamperedManifest
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badCode:          return "That enrollment code wasn't recognised."
        case .offline:          return "No connection. Try again when you have signal."
        case .tamperedManifest: return "Cached data failed its signature check."
        case .server(let m):    return m
        }
    }
}

/// Selects the active backend. Mock is the default so the whole loop runs on a
/// device today, before /api/door/* ships. Flip `useMock` to false once wired.
enum RepoFactory {
    static let useMock = false   // live: hits /api/door/* on clubfuoco.vercel.app
    static func make() -> DoorRepo { useMock ? MockDoorRepo() : DoorAPIRepo() }
}

struct DoorVenue: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let neighborhood: String?
    let bookingCount: Int
}

/// App-wide mode switches.
enum AppMode {
    /// Open access: skip device enrollment entirely — anyone can open the app
    /// and scan/void. Deliberate while there are NO partner clubs to scope a
    /// device to (nothing sensitive to protect yet). Flip to `false` the day a
    /// real partner club onboards, which restores the enrollment-code gate.
    ///
    /// NOTE: open access assumes the mock backend. With `useMock = false` the
    /// server still requires an enrolled device token, so re-enable enrollment
    /// (or add a server open-mode) before pointing at the live API.
    static let openAccess = true
}
