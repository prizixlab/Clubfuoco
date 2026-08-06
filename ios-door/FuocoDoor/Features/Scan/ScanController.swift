import Foundation
import SwiftUI

/// Orchestrates a single scan: resolve payload → present verdict → record the
/// admission or a void. Deduplicates rapid re-reads of the same QR so the door
/// doesn't double-count when the camera locks onto a code for several frames.
@MainActor
final class ScanController: ObservableObject {
    @Published var current: AccessDescriptor?      // result sheet payload
    @Published var lastRecordedScanId: UUID?       // enables swipe-to-void on the result
    @Published var isResolving = false             // a live resolve is in flight
    @Published var toast: String?

    private let store: DoorStore
    private let repo: DoorRepo
    private let pack: NightPackStore
    private var recentlyScanned: [String: Date] = [:]
    private let dedupeWindow: TimeInterval = 3.0

    init(store: DoorStore, repo: DoorRepo, pack: NightPackStore) {
        self.store = store; self.repo = repo; self.pack = pack
    }

    /// Returns true if this payload should be shown (not a duplicate within the
    /// dedupe window). The scanner keeps firing while a code is in frame.
    func shouldPresent(payload: String) -> Bool {
        let now = Date()
        if let t = recentlyScanned[payload], now.timeIntervalSince(t) < dedupeWindow { return false }
        recentlyScanned[payload] = now
        return true
    }

    /// Resolve a scanned payload and open the result sheet. Live-first (the
    /// resolve endpoint handles real QRs / URL payloads), falling back to the
    /// cached manifest when offline, then to an explicit invalid verdict.
    func present(payload: String) async {
        guard !isResolving else { return }
        isResolving = true
        lastRecordedScanId = nil
        defer { isResolving = false }
        // Encrypted pack first: it's a local decrypt (~0.02ms for a modern
        // ticket) and works with no signal. The scanned QR is the only thing
        // that can open the entry, so this reveals nothing the door didn't scan.
        if let desc = pack.open(payload: payload) {
            current = withLocalDelta(desc)
            if desc.status.admits { Haptics.tap() } else { Haptics.error() }
            return
        }
        do {
            let desc = try await repo.resolve(payload)
            current = desc
            if desc.status.admits { Haptics.tap() } else { Haptics.error() }
        } catch {
            // Offline and not in the pack → older cached manifest, else invalid.
            if let desc = store.resolveLocal(payload: payload) {
                current = desc; Haptics.tap()
            } else {
                current = invalidDescriptor(payload: payload); Haptics.error()
            }
        }
    }

    /// The pack's `used` is the server's count at download time; fold in any
    /// admissions this device has made since that haven't synced yet.
    private func withLocalDelta(_ d: AccessDescriptor) -> AccessDescriptor {
        let delta = store.queue.filter { !$0.synced && $0.tokenRef == d.tokenRef }
            .reduce(0) { $0 + ($1.action == .admit ? $1.count : -$1.count) }
        guard delta != 0 else { return d }
        var copy = d
        let used = max(0, d.allowance.used + delta)
        copy.allowance = Allowance(used: used, allowed: d.allowance.allowed)
        copy.status = used >= d.allowance.allowed && used > 0 ? .over : d.status
        return copy
    }

    /// Record `count` heads entering now against this token (§2 primary action).
    func admit(_ desc: AccessDescriptor, count: Int) {
        let scan = QueuedScan(scanId: UUID(), action: .admit, tokenRef: desc.tokenRef,
                              count: count, deviceTime: Date(),
                              holderName: desc.holderName, kind: desc.kind, reason: nil)
        store.enqueue(scan)
        push(scan)
        lastRecordedScanId = scan.scanId
        let nowUsed = store.admittedCount(desc.tokenRef)
        if nowUsed > desc.allowance.allowed { Haptics.warning() } else { Haptics.success() }
        toast = "Admitted \(count) · \(desc.kind.label) · \(desc.holderName)"
        current = nil
    }

    /// Send a record to the server. Failure is fine — it stays unsynced in the
    /// local queue and is retried on the next sync.
    private func push(_ scan: QueuedScan) {
        Task { [repo, store] in
            do {
                try await repo.record(scan)
                store.markSynced([scan.scanId])
            } catch {
                // stays queued
            }
        }
    }

    /// Void a just-recorded admission (§3 swipe-to-void). Idempotent by design:
    /// re-voiding the same scanId reverses nothing new.
    func void(scanId: UUID, desc: AccessDescriptor, reason: String? = nil) {
        // Reverse exactly the heads that admission added.
        guard let admitRec = store.queue.first(where: { $0.scanId == scanId && $0.action == .admit }) else { return }
        let v = QueuedScan(scanId: UUID(), action: .void, tokenRef: desc.tokenRef,
                           count: admitRec.count, deviceTime: Date(),
                           holderName: desc.holderName, kind: desc.kind, reason: reason)
        store.enqueue(v)
        push(v)
        Haptics.heavy()
        toast = "Voided · \(desc.kind.label) · \(desc.holderName)"
        lastRecordedScanId = nil
        current = nil
    }

    /// Void a record straight from the recent-scans list.
    func voidRecord(_ rec: QueuedScan) {
        guard rec.action == .admit else { return }
        let v = QueuedScan(scanId: UUID(), action: .void, tokenRef: rec.tokenRef,
                           count: rec.count, deviceTime: Date(),
                           holderName: rec.holderName, kind: rec.kind, reason: nil)
        store.enqueue(v)
        push(v)
        Haptics.heavy()
        toast = "Voided · \(rec.kind.label) · \(rec.holderName)"
    }

    private func invalidDescriptor(payload: String) -> AccessDescriptor {
        AccessDescriptor(holderName: "Unknown code", holderAvatarUrl: nil, kind: .paidEntry,
                         entitlement: Entitlement(label: String(payload.prefix(24)), count: 0, extras: []),
                         allowance: Allowance(used: 0, allowed: 0), status: .invalid,
                         venue: store.manifest?.venue ?? "", night: store.manifest?.night ?? "",
                         tokenRef: "invalid-\(payload)")
    }
}
