import Foundation
import Combine

/// Owns the offline/sync contract (§4): local-first operation, opportunistic
/// sync, soft warnings, and the hard 12-hour lock. A "full sync" = push the
/// whole queued log AND pull a fresh manifest, both succeeding.
@MainActor
final class SyncManager: ObservableObject {
    enum SyncLevel { case fresh, warn, locked }

    @Published private(set) var lastFullSyncAt: Date?
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    @Published private(set) var now = Date()

    // The 12-hour ceiling and the soft-warning threshold (§4).
    static let ceiling: TimeInterval = 12 * 3600
    static let warnAfter: TimeInterval = 9 * 3600

    private let repo: DoorRepo
    private let store: DoorStore
    private let session: DeviceSession
    private var ticker: AnyCancellable?

    private static let lastSyncKey = "cf.door.lastFullSyncAt"

    init(repo: DoorRepo, store: DoorStore, session: DeviceSession) {
        self.repo = repo
        self.store = store
        self.session = session
        if let t = UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date {
            lastFullSyncAt = t
        }
        // Drive the countdown / lock banner once a minute.
        ticker = Timer.publish(every: 30, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] t in self?.now = t }
    }

    var sinceLastSync: TimeInterval? {
        guard let last = lastFullSyncAt else { return nil }
        return now.timeIntervalSince(last)
    }

    /// The gate the scanner checks before accepting a new scan.
    var level: SyncLevel {
        guard let since = sinceLastSync else { return .warn }  // never synced → nudge
        if since >= Self.ceiling { return .locked }
        if since >= Self.warnAfter { return .warn }
        return .fresh
    }

    /// Hard block (the anti-abuse point): true once ≥12h without a full sync.
    /// Never locks in open-access mode — there's no manifest/venue to go stale.
    var isLocked: Bool { !AppMode.openAccess && level == .locked }

    var hoursSinceSync: Double? { sinceLastSync.map { $0 / 3600 } }

    /// Full data transfer: push queued scans/voids, pull a fresh signed manifest.
    /// Both must succeed to reset the 12-hour clock.
    @discardableResult
    func fullSync(date: String) async -> Bool {
        guard !isSyncing else { return false }
        isSyncing = true; lastError = nil
        defer { isSyncing = false }
        do {
            let pending = store.unsynced
            let result = try await repo.sync(scans: pending,
                                             venue: session.venue,
                                             date: date,
                                             deviceToken: session.deviceToken)
            store.markSynced(Set(result.acceptedScanIds))
            store.setManifest(result.manifest)
            // Correct device clock drift against server time; reset the ceiling.
            let stamp = result.manifest.serverTime
            lastFullSyncAt = stamp
            now = stamp
            UserDefaults.standard.set(stamp, forKey: Self.lastSyncKey)
            if !result.rejectedScanIds.isEmpty {
                // Rejections = overscan flagged by another door; surfaced, not dropped.
                lastError = "\(result.rejectedScanIds.count) scan(s) flagged as overscan."
            }
            return true
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? "Sync failed."
            return false
        }
    }

    /// Initial manifest pull when going on-shift.
    func goOnShift(date: String) async {
        isSyncing = true; lastError = nil
        defer { isSyncing = false }
        do {
            let m = try await repo.fetchManifest(venue: session.venue, date: date,
                                                 deviceToken: session.deviceToken)
            store.setManifest(m)
            lastFullSyncAt = m.serverTime
            now = m.serverTime
            UserDefaults.standard.set(m.serverTime, forKey: Self.lastSyncKey)
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? "Couldn't load tonight's list."
        }
    }
}
