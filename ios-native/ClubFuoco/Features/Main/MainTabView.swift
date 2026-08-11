import SwiftUI

/// Native replacement for BottomNav. Phase 0 ships the `user` tab set
/// (Explore / Tickets / You); the club and dj sets follow with their
/// dashboards in Phase 3.
struct MainTabView: View {
    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @Environment(AuthStore.self) private var auth
    @Environment(DJPlayer.self) private var djPlayer
    @State private var reopenDJ: FeaturedDJ?

    enum Tab: String {
        case explore, tickets, you
    }

    @State private var selection: Tab = MainTabView.initialTab()
    // Badge dots — pending group invites on Tickets, incoming friend requests
    // on You (mirrors BottomNav's alert dots). Refreshed per tab switch.
    @State private var ticketAlerts = 0
    @State private var youAlerts = 0

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack { ExploreView() }
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
        // Persistent now-playing bar above the tab bar; audio keeps going as the
        // user moves between tabs and screens.
        .overlay(alignment: .bottom) {
            DJMiniBar { dj in reopenDJ = dj }
                .padding(.horizontal, 10)
                .padding(.bottom, 52)          // sit just above the tab bar
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: djPlayer.isActive)
        }
        .sheet(item: $reopenDJ) { dj in
            FeaturedDJSheet(dj: dj, autoplay: false, bookable: false, onBook: nil)
        }
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
