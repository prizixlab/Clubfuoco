import SwiftUI

struct RootView: View {
    @StateObject private var auth = AuthStore()

    var body: some View {
        Group {
            switch auth.state {
            case .loading:
                ZStack {
                    Theme.night.ignoresSafeArea()
                    ProgressView().tint(Theme.parchment)
                }
            case .signedOut:
                SignInView()
            case .signedIn:
                MainTabs()
            }
        }
        .environmentObject(auth)
    }
}

struct MainTabs: View {
    @State private var selection: Tab = .tonight
    enum Tab: Hashable { case tonight, guestlist, earnings, you }

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack { TonightView() }
                .tabItem { Label("Tonight", systemImage: "moon") }
                .tag(Tab.tonight)

            NavigationStack { GuestlistTabRoot() }
                .tabItem { Label("Guestlist", systemImage: "list.bullet") }
                .tag(Tab.guestlist)

            NavigationStack { EarningsView() }
                .tabItem { Label("Earnings", systemImage: "creditcard") }
                .tag(Tab.earnings)

            NavigationStack { YouView() }
                .tabItem { Label("You", systemImage: "person") }
                .tag(Tab.you)
        }
        .tint(Theme.ember)
        .toolbarBackground(Theme.night, for: .tabBar)
    }
}

/// Guestlist tab without a specific allocation just lists the user's nights
/// and lets them pick one. Same view as Tonight but framed differently.
struct GuestlistTabRoot: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model = TonightModel()
    @State private var showCreate = false
    @State private var navigateTo: PromoterAllocation?
    @State private var pendingDelete: PromoterAllocation?
    @State private var deleting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Guestlist")
                            .font(.cfSerif(40))
                            .foregroundStyle(Theme.parchment)
                        Text("Pick a night, or create a new one.")
                            .font(.cfSans(13))
                            .foregroundStyle(Theme.parchmentDim)
                    }
                    Spacer()
                    Button {
                        Haptics.tap()
                        showCreate = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Theme.emberCream)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Theme.ember))
                    }
                }

                if model.loading {
                    ProgressView().tint(Theme.parchment).padding(.top, 40)
                } else if model.allocations.isEmpty {
                    Text("No nights assigned yet.")
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.parchmentDim)
                        .padding(.top, 24)
                } else {
                    Text("Swipe a night left to delete.")
                        .font(.cfMono(10))
                        .kerning(1.5)
                        .foregroundStyle(Theme.parchmentDim)
                        .padding(.top, 4)
                    List {
                        ForEach(model.allocations) { a in
                            ZStack {
                                NavigationLink(value: a) { EmptyView() }.opacity(0)
                                GuestlistRow(allocation: a)
                            }
                            .listRowBackground(Theme.night)
                            .listRowSeparatorTint(Theme.hairline)
                            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    pendingDelete = a
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Theme.night)
                    .frame(minHeight: CGFloat(model.allocations.count) * 80 + 20)
                }
                Spacer(minLength: 80)
            }
            .padding(20)
        }
        .background(Theme.night)
        .alert("Delete this guestlist?",
               isPresented: Binding(get: { pendingDelete != nil },
                                    set: { if !$0 { pendingDelete = nil } })) {
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) {
                if let target = pendingDelete { Task { await delete(target) } }
            }
        } message: {
            if let p = pendingDelete {
                Text("\(p.night?.displayTitle ?? "This night") on \(p.night?.nightDate ?? "") will be removed along with all guests on the list. This can't be undone.")
            }
        }
        .task { await model.load() }
        .onAppear { Task { await model.load() } }
        .refreshable { await model.load() }
        .navigationDestination(for: PromoterAllocation.self) { a in
            GuestlistView(allocation: a)
        }
        .navigationDestination(item: $navigateTo) { a in
            GuestlistView(allocation: a)
        }
        .overlay {
            if deleting {
                ZStack {
                    Color.black.opacity(0.4).ignoresSafeArea()
                    ProgressView().tint(Theme.parchment)
                }
            }
        }
        .sheet(isPresented: $showCreate) {
            if case .signedIn(let p) = auth.state {
                CreateGuestlistSheet(promoterId: p.id) { newAlloc in
                    showCreate = false
                    Task {
                        await model.load()
                        navigateTo = newAlloc
                    }
                }
                .presentationBackground(Theme.night)
            }
        }
    }

    private func delete(_ a: PromoterAllocation) async {
        deleting = true
        defer { deleting = false; pendingDelete = nil }
        do {
            try await PromoterRepo().deleteAllocation(allocationId: a.id)
            Haptics.success()
            await model.load()
        } catch {
            Haptics.error()
        }
    }
}

private struct GuestlistRow: View {
    let allocation: PromoterAllocation
    var body: some View {
        let title = allocation.night?.displayTitle ?? "Night"
        let subtitle = (allocation.night?.club?.name ?? "") + " · " + (allocation.night?.nightDate ?? "")
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.cfSerif(20))
                    .foregroundStyle(Theme.parchment)
                Text(subtitle)
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.parchmentDim)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .foregroundStyle(Theme.parchmentDim)
        }
        .padding(.vertical, 16)
        .contentShape(Rectangle())
    }
}

#Preview { RootView() }
