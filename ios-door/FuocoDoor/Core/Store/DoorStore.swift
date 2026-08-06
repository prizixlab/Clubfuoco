import Foundation

/// Local-first authority for the shift (§4). Holds the cached night manifest and
/// the append-only scan/void queue, both persisted to disk so they survive an
/// app kill or battery death. Local counters are authoritative for the UI; the
/// server reconciles on sync and is the source of truth for billing.
///
/// v1 persistence is atomic JSON files in Application Support. The plan calls for
/// SQLite/CoreData + encryption at rest — a deliberate follow-up (see README).
@MainActor
final class DoorStore: ObservableObject {
    @Published private(set) var manifest: NightManifest?
    @Published private(set) var queue: [QueuedScan] = []
    /// Live per-token admission counts = manifest baseline + queued deltas.
    @Published private(set) var liveUsed: [String: Int] = [:]

    private let dir: URL
    private let manifestURL: URL
    private let queueURL: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = base.appendingPathComponent("FuocoDoor", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        manifestURL = dir.appendingPathComponent("manifest.json")
        queueURL = dir.appendingPathComponent("queue.json")
        load()
    }

    // MARK: Manifest

    func setManifest(_ m: NightManifest) {
        manifest = m
        persistManifest()
        recomputeLiveUsed()
    }

    func entry(forPayload payload: String) -> ManifestEntry? {
        manifest?.entries.first { $0.payloadKeys.contains(payload) || $0.tokenRef == payload }
    }

    /// Resolve a raw QR payload into an Access Descriptor against the local
    /// manifest — instant verdict, no network round-trip.
    func resolveLocal(payload: String) -> AccessDescriptor? {
        guard let m = manifest, let e = entry(forPayload: payload) else { return nil }
        let used = liveUsed[e.tokenRef] ?? 0
        let status: AccessStatus = used >= e.allowed ? .over : .ok
        return AccessDescriptor(
            holderName: e.holderName,
            holderAvatarUrl: e.holderAvatarUrl,
            kind: e.kind,
            entitlement: e.entitlement,
            allowance: Allowance(used: used, allowed: e.allowed),
            status: status,
            venue: m.venue,
            night: m.night,
            tokenRef: e.tokenRef
        )
    }

    // MARK: Queue

    /// Append an admission/void and update live counters immediately.
    func enqueue(_ scan: QueuedScan) {
        queue.append(scan)
        persistQueue()
        recomputeLiveUsed()
    }

    func markSynced(_ ids: Set<UUID>) {
        for i in queue.indices where ids.contains(queue[i].scanId) { queue[i].synced = true }
        // Prune acked records — keep unsynced plus a small recent tail for the UI.
        let recentTail = 40
        let unsynced = queue.filter { !$0.synced }
        let syncedTail = queue.filter(\.synced).suffix(recentTail)
        queue = (unsynced + syncedTail).sorted { $0.deviceTime < $1.deviceTime }
        persistQueue()
    }

    var unsynced: [QueuedScan] { queue.filter { !$0.synced } }

    /// Most recent admissions/voids for the recent-scans list (§3).
    func recent(limit: Int = 25) -> [QueuedScan] {
        Array(queue.sorted { $0.deviceTime > $1.deviceTime }.prefix(limit))
    }

    /// Net admitted heads for a token, honouring voids.
    func admittedCount(_ tokenRef: String) -> Int { liveUsed[tokenRef] ?? 0 }

    private func recomputeLiveUsed() {
        // Baseline from the server's cross-door `used` (so a second door sees the
        // first door's admissions), then add only UNSYNCED local deltas on top —
        // synced records are already folded into the server baseline.
        var map: [String: Int] = [:]
        for e in manifest?.entries ?? [] { map[e.tokenRef] = e.used ?? 0 }
        for s in queue where !s.synced {
            map[s.tokenRef, default: 0] += (s.action == .admit ? s.count : -s.count)
        }
        for k in map.keys { map[k] = max(0, map[k]!) }
        liveUsed = map
    }

    // MARK: Persistence

    private func persistManifest() { write(manifest, to: manifestURL) }
    private func persistQueue() { write(queue, to: queueURL) }

    private func load() {
        if let m: NightManifest = read(manifestURL) { manifest = m }
        if let q: [QueuedScan] = read(queueURL) { queue = q }
        recomputeLiveUsed()
    }

    private func write<T: Encodable>(_ value: T?, to url: URL) {
        guard let value else { try? FileManager.default.removeItem(at: url); return }
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        guard let data = try? enc.encode(value) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func read<T: Decodable>(_ url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try? dec.decode(T.self, from: data)
    }
}
