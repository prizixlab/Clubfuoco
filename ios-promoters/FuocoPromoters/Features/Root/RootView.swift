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
            case .signedIn(let profile):
                if profile.isPromoter {
                    MainTabs()
                } else {
                    // Signed in but not a promoter → application flow.
                    PromoterApplicationView()
                }
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
    @State private var seriesOccurrence: SeriesOccurrence?
    @State private var pendingDelete: PromoterAllocation?
    @State private var deleting = false
    @State private var opening = false

    var body: some View {
        VStack(spacing: 0) {
        FuocoHeader(initials: headerInitials)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Guestlist")
                            .font(.cfSerif(40))
                            .foregroundStyle(Theme.parchment)
                        Text("Pick a night, or create a new one")
                            .font(.cfSans(13))
                            .foregroundStyle(Theme.parchmentDim)
                    }
                    Spacer()
                    Button {
                        Haptics.tap()
                        showCreate = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Theme.emberCream)
                            .frame(width: 52, height: 52)
                            .background(Circle().fill(Theme.ember))
                    }
                }
                .padding(.top, 8)

                if !model.series.isEmpty {
                    Kicker("Permanent links", color: Theme.parchmentDim).padding(.top, 8)
                    VStack(spacing: 14) {
                        ForEach(model.series) { s in
                            Button { Haptics.tap(); Task { await openSeries(s) } } label: {
                                SeriesRow(series: s)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if !model.allocations.isEmpty {
                        HStack {
                            Kicker("One-off nights", color: Theme.parchmentDim)
                            Spacer()
                            Text("Slide to manage")
                                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                        }
                        .padding(.top, 16)
                    }
                }

                if model.loading {
                    ProgressView().tint(Theme.parchment).padding(.top, 40)
                } else if model.allocations.isEmpty && model.series.isEmpty {
                    Text("No nights assigned yet.")
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.parchmentDim)
                        .padding(.top, 24)
                } else if !model.allocations.isEmpty {
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
        .task {
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                await model.load()
            }
        }
        .onAppear { Task { await model.load() } }
        .refreshable { await model.load() }
        .navigationDestination(for: PromoterAllocation.self) { a in
            GuestlistView(allocation: a)
        }
        .navigationDestination(item: $navigateTo) { a in
            GuestlistView(allocation: a)
        }
        .overlay {
            if deleting || opening {
                ZStack {
                    Color.black.opacity(0.4).ignoresSafeArea()
                    ProgressView().tint(Theme.parchment)
                }
            }
        }
        .sheet(isPresented: $showCreate) {
            if case .signedIn(let p) = auth.state {
                CreateGuestlistSheet(promoterId: p.id) { result in
                    showCreate = false
                    Task {
                        await model.load()
                        switch result {
                        case .allocation(let a): navigateTo = a
                        case .series(let s): await openSeries(s)
                        }
                    }
                }
                .presentationBackground(Theme.night)
            }
        }
        .navigationDestination(item: $seriesOccurrence) { occ in
            GuestlistView(allocation: occ.allocation, shareTokenOverride: occ.token)
        }
        }
        .background(Theme.night.ignoresSafeArea())
    }

    private var headerInitials: String {
        if case .signedIn(let p) = auth.state {
            return String(p.displayName.prefix(1)).uppercased()
        }
        return ""
    }

    private func openSeries(_ s: PromoterSeries) async {
        opening = true
        defer { opening = false }
        if let alloc = try? await PromoterRepo().currentAllocation(forSeries: s.id) {
            seriesOccurrence = SeriesOccurrence(allocation: alloc, token: s.inviteToken)
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

struct SeriesOccurrence: Identifiable, Hashable {
    let allocation: PromoterAllocation
    let token: String
    var id: UUID { allocation.id }
}

private struct SeriesRow: View {
    let series: PromoterSeries
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Theme.ember.opacity(0.15))
                        .frame(width: 48, height: 48)
                    Image(systemName: "repeat")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Theme.ember)
                }
                Spacer()
                Text("ACTIVE")
                    .font(.cfMono(9, weight: .medium)).kerning(1.5)
                    .foregroundStyle(Theme.emberCream)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Capsule().fill(Theme.ember))
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(series.displayTitle)
                    .font(.cfSerif(24))
                    .foregroundStyle(Theme.parchment)
                HStack(spacing: 6) {
                    Image(systemName: "flame.fill").font(.system(size: 9)).foregroundStyle(Theme.ember)
                    Text(series.weekdayLabel.uppercased() + " · PERMANENT")
                        .font(.cfMono(10, weight: .medium)).kerning(1.2)
                        .foregroundStyle(Theme.flame)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.hairline))
        .contentShape(Rectangle())
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
