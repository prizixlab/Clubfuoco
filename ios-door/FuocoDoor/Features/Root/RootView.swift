import SwiftUI

/// Routes between enrollment and the live scan screen based on a persisted
/// DeviceSession. One shared DoorStore instance backs the scan surface so the
/// manifest cache and queue survive across the session.
struct RootView: View {
    @State private var session: DeviceSession? = RootView.liveSession()
    @State private var joiningEvent = false
    @StateObject private var store = DoorStore()
    @StateObject private var pack = NightPackStore()
    private let repo = RepoFactory.make()

    /// An event session that has passed its ceiling is not a session.
    ///
    /// The server stops accepting the token at the night's end + 12h, so
    /// keeping it on screen would leave a door scanning into 403s with no clue
    /// why. Expiring it here sends them straight back to the code entry.
    private static func liveSession() -> DeviceSession? {
        guard let s = DeviceSession.load() else { return nil }
        if s.isEventScoped && s.eventExpired { DeviceSession.clear(); return nil }
        return s
    }

    var body: some View {
        Group {
            if let session {
                ScanView(session: session, repo: repo, store: store, pack: pack) {
                    // Re-read the persisted session so the whole screen rebinds.
                    withAnimation { self.session = RootView.liveSession() }
                }
            } else if AppMode.openAccess {
                // No enrollment credential, but the door still commits to one
                // scope — a venue, or one secured event. Otherwise it could
                // admit anyone's ticket anywhere.
                //
                // The picker owns the event-code path itself, so this no longer
                // routes it. That indirection is what let ScanView's "change
                // venue" ship without a way into a secured event at all.
                VenuePickerView(repo: repo) { picked in
                    withAnimation { session = picked }
                }
            } else {
                EnrollView { newSession in
                    withAnimation { session = newSession }
                }
            }
        }
    }
}
