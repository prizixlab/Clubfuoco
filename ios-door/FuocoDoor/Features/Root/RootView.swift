import SwiftUI

/// Routes between enrollment and the live scan screen based on a persisted
/// DeviceSession. One shared DoorStore instance backs the scan surface so the
/// manifest cache and queue survive across the session.
struct RootView: View {
    @State private var session: DeviceSession? = DeviceSession.load()
    @StateObject private var store = DoorStore()
    @StateObject private var pack = NightPackStore()
    private let repo = RepoFactory.make()

    var body: some View {
        Group {
            if let session {
                ScanView(session: session, repo: repo, store: store, pack: pack)
            } else if AppMode.openAccess {
                // No partner clubs yet → no enrollment gate. Straight to scanning.
                Color.clear.onAppear { session = DeviceSession.openDefault() }
            } else {
                EnrollView { newSession in
                    withAnimation { session = newSession }
                }
            }
        }
    }
}
