import SwiftUI

/// Pushes a venue detail onto the enclosing navigation stack. Provided through
/// the environment so cards can navigate WITHOUT wrapping themselves in a
/// NavigationLink — a full-card NavigationLink lets an adjacent card's link
/// claim taps near the shared edge (tapping one card's bookmark opened the
/// venue beside it). A frame-scoped `.onTapGesture { pushPlace(place) }` cannot
/// bleed into a neighbour, and the save button overlay still wins its own area.
private struct PushPlaceKey: EnvironmentKey {
    static let defaultValue: (Place) -> Void = { _ in }
}
extension EnvironmentValues {
    var pushPlace: (Place) -> Void {
        get { self[PushPlaceKey.self] }
        set { self[PushPlaceKey.self] = newValue }
    }
}

/// Native replacement for BottomNav. Phase 0 ships the `user` tab set
/// (Explore / Tickets / You); the club and dj sets follow with their
/// dashboards in Phase 3.
struct MainTabView: View {
    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @Environment(AuthStore.self) private var auth

    enum Tab: String {
        case explore, tickets, you
    }

    @State private var selection: Tab = MainTabView.initialTab()
    // Badge dots — pending group invites on Tickets, incoming friend requests
    // on You (mirrors BottomNav's alert dots). Refreshed per tab switch.
    @State private var ticketAlerts = 0
    @State private var youAlerts = 0
    // Explicit path so cards can push venues programmatically (see PushPlaceKey).
    @State private var explorePath = NavigationPath()

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack(path: $explorePath) { ExploreView() }
                // Set on the stack (not on ExploreView) so pushed destinations —
                // ShelfListView's rows, etc. — inherit it too.
                .environment(\.pushPlace, { explorePath.append($0) })
                .tabItem { Label(locale.t("nav.explore"), systemImage: "safari") }
                .tag(Tab.explore)

            NavigationStack {
                if auth.user == nil {
                    GuestGateView()
                } else {
                    BookingsView()
                }
            }
            .tabItem { Label(locale.t("nav.tickets"), systemImage: "ticket") }
            .badge(ticketAlerts)
            .tag(Tab.tickets)

            NavigationStack {
                if auth.user == nil {
                    GuestGateView()
                } else {
                    ProfileView()
                }
            }
            .tabItem { Label(locale.t("nav.you"), systemImage: "person") }
            .badge(youAlerts)
            .tag(Tab.you)
        }
        .tint(Theme.ink)
        .task { await refreshBadges() }
        .onChange(of: selection) {
            Task { await refreshBadges() }
        }
    }

    private func refreshBadges() async {
        guard auth.user != nil, !auth.isAnonymous else { return }
        async let friends: FriendsData? = try? api.get("/api/friends")
        async let groups: [GroupListItem]? = try? api.get("/api/groups")
        youAlerts = await friends?.incoming.count ?? 0
        ticketAlerts = await (groups ?? []).filter { $0.status == "open" && $0.myRsvp == "invited" }.count
    }

    private static func initialTab() -> Tab {
        #if DEBUG
        // Automated Simulator runs can deep-select a tab via
        // SIMCTL_CHILD_CF_TEST_TAB — same spirit as the auto-login hook.
        if let raw = ProcessInfo.processInfo.environment["CF_TEST_TAB"],
           let tab = Tab(rawValue: raw) {
            return tab
        }
        #endif
        return .explore
    }
}
