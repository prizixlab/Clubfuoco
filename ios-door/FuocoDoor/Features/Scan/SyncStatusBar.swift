import SwiftUI

/// Top banner reflecting the offline/sync state (§4). Amber soft-warning from 9h,
/// hard lock at 12h. Tapping runs a full sync.
struct SyncStatusBar: View {
    @ObservedObject var sync: SyncManager
    var pendingCount: Int
    var onSync: () -> Void

    private var color: Color {
        switch sync.level {
        case .fresh:  return Theme.admit
        case .warn:   return Theme.over
        case .locked: return Theme.deny
        }
    }
    private var text: String {
        if sync.isSyncing { return "Syncing…" }
        guard let h = sync.hoursSinceSync else { return "Not yet synced — tap to sync" }
        switch sync.level {
        case .fresh:  return String(format: "Synced %.0fm ago", (sync.sinceLastSync ?? 0) / 60)
        case .warn:   return String(format: "Last sync %.1fh ago — sync soon", h)
        case .locked: return String(format: "Locked · last sync %.0fh ago", h)
        }
    }

    var body: some View {
        Button(action: onSync) {
            HStack(spacing: 10) {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(text).font(.cfMono(12)).foregroundStyle(Theme.parchment)
                Spacer()
                if pendingCount > 0 {
                    Text("\(pendingCount) queued")
                        .font(.cfMono(11)).foregroundStyle(Theme.flame)
                }
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.parchmentDim)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.nightLift)
            .overlay(Rectangle().fill(color).frame(height: 2), alignment: .bottom)
        }
        .disabled(sync.isSyncing)
    }
}
