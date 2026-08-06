import Foundation

/// In-memory stand-in for the not-yet-built /api/door/* endpoints. Lets the full
/// scan → access → void → sync loop run on a real device today. It fabricates a
/// believable night manifest and echoes sync as all-accepted.
///
/// Demo QR payloads (make QR codes for these to test at a door):
///   PAID-ADA-4      paid entry, party of 4
///   VIP-LEO-6       VIP table, party of 6
///   GUEST-MIA-2     free guestlist, +2 (billable:false)
///   TICKET-JAX-1    single ticket
///   MEMBER-GOLD-1   gold membership
struct MockDoorRepo: DoorRepo {
    func enroll(code: String) async throws -> EnrollResult {
        try await Task.sleep(nanoseconds: 500_000_000)
        guard !code.trimmingCharacters(in: .whitespaces).isEmpty else { throw DoorRepoError.badCode }
        return EnrollResult(deviceToken: "mock-\(UUID().uuidString.prefix(8))",
                            venue: "villa-agrippina",
                            venueName: "Villa Agrippina")
    }

    func resolve(_ payload: String) async throws -> AccessDescriptor {
        try await Task.sleep(nanoseconds: 250_000_000)
        let m = Self.demoManifest(venue: "villa-agrippina", date: "2026-08-05")
        if let e = m.entries.first(where: { $0.payloadKeys.contains(payload) || $0.tokenRef == payload }) {
            return AccessDescriptor(
                holderName: e.holderName, holderAvatarUrl: e.holderAvatarUrl, kind: e.kind,
                entitlement: e.entitlement, allowance: Allowance(used: 0, allowed: e.allowed),
                status: .ok, venue: m.venue, night: m.night, tokenRef: e.tokenRef)
        }
        return AccessDescriptor(
            holderName: "Unknown code", holderAvatarUrl: nil, kind: .paidEntry,
            entitlement: Entitlement(label: String(payload.prefix(24)), count: 0, extras: []),
            allowance: Allowance(used: 0, allowed: 0), status: .invalid,
            venue: m.venue, night: m.night, tokenRef: "invalid-\(payload)")
    }

    func record(_ scan: QueuedScan) async throws { /* demo backend — nothing to persist */ }

    func venues(date: String) async throws -> [DoorVenue] {
        [DoorVenue(id: "villa-agrippina", name: "Villa Agrippina", neighborhood: "Trastevere", bookingCount: 5)]
    }

    func nightPack(venue: String, date: String) async throws -> EncryptedManifest {
        EncryptedManifest(venue: venue, venueName: "Villa Agrippina", night: date,
                          issuedAt: "", serverTime: "", entries: [], scheme: "v1")
    }

    func fetchManifest(venue: String, date: String, deviceToken: String) async throws -> NightManifest {
        try await Task.sleep(nanoseconds: 600_000_000)
        return Self.demoManifest(venue: venue, date: date)
    }

    func sync(scans: [QueuedScan], venue: String, date: String, deviceToken: String) async throws -> SyncResult {
        try await Task.sleep(nanoseconds: 700_000_000)
        // Server would dedupe on scanId and reconcile allowances across doors.
        // The mock accepts everything and returns a refreshed manifest.
        return SyncResult(
            acceptedScanIds: scans.map(\.scanId),
            rejectedScanIds: [],
            manifest: Self.demoManifest(venue: venue, date: date)
        )
    }

    static func demoManifest(venue: String, date: String) -> NightManifest {
        let entries: [ManifestEntry] = [
            ManifestEntry(tokenRef: "bk_ada", payloadKeys: ["PAID-ADA-4"],
                          holderName: "Ada Moreno", holderAvatarUrl: nil, kind: .paidEntry,
                          entitlement: Entitlement(label: "Paid entry · party of 4", count: 4, extras: ["Arrival 23:00–00:30"]),
                          allowed: 4, billable: true),
            ManifestEntry(tokenRef: "bk_leo", payloadKeys: ["VIP-LEO-6"],
                          holderName: "Leo Ferrari", holderAvatarUrl: nil, kind: .vipTable,
                          entitlement: Entitlement(label: "VIP table · party of 6", count: 6, extras: ["Table 12", "Bottle service"]),
                          allowed: 6, billable: true),
            ManifestEntry(tokenRef: "pg_mia", payloadKeys: ["GUEST-MIA-2"],
                          holderName: "Mia Rossi", holderAvatarUrl: nil, kind: .guestlist,
                          entitlement: Entitlement(label: "Guestlist +2", count: 3, extras: ["via @promoter.sol"]),
                          allowed: 3, billable: false),
            ManifestEntry(tokenRef: "tk_jax", payloadKeys: ["TICKET-JAX-1"],
                          holderName: "Jax Turner", holderAvatarUrl: nil, kind: .ticket,
                          entitlement: Entitlement(label: "Event ticket ×1", count: 1, extras: []),
                          allowed: 1, billable: true),
            ManifestEntry(tokenRef: "mb_gold", payloadKeys: ["MEMBER-GOLD-1"],
                          holderName: "Nadia Khan", holderAvatarUrl: nil, kind: .membership,
                          entitlement: Entitlement(label: "Gold member", count: 1, extras: ["Priority entry", "+1 guest"]),
                          allowed: 2, billable: false),
        ]
        return NightManifest(venue: venue, venueName: "Villa Agrippina", night: date,
                             issuedAt: Date(), serverTime: Date(), entries: entries,
                             signature: "mock-signature")
    }
}
