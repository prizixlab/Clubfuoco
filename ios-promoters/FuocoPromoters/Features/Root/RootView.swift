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
                if profile.accountKind != "promoter" {
                    WrongAccountView()           // a consumer account on the promoter app
                } else if profile.isPromoter {
                    MainTabs()                   // full app; adds an Offers tab for suppliers
                } else {
                    PromoterApplicationView()    // locked: pending verification
                }
            }
        }
        .environmentObject(auth)
    }
}

/// Shown if a non-promoter (consumer) account somehow signs in here.
struct WrongAccountView: View {
    @EnvironmentObject var auth: AuthStore
    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "person.crop.circle.badge.xmark")
                    .font(.system(size: 40)).foregroundStyle(Theme.flame)
                Text("Not a promoter account")
                    .font(.cfSerif(28)).foregroundStyle(Theme.parchment)
                Text("This is a Club Fuoco account. Use the Club Fuoco app, or sign up here to apply as a promoter.")
                    .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                    .multilineTextAlignment(.center).padding(.horizontal, 40)

                // Sign out lands them on the sign-in screen, where "Apply" opens
                // the promoter signup.
                EmberPillButton(title: "Apply as promoter", trailingIcon: "arrow.right") {
                    Task { await auth.signOut() }
                }
                .padding(.horizontal, 40)
                .padding(.top, 8)

                Button { Task { await auth.signOut() } } label: {
                    Text("Sign out").font(.cfMono(11, weight: .medium)).kerning(2)
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            .padding(24)
        }
    }
}

// Promoters and suppliers are ONE role — there is no separate "supplier
// experience". Every account gets the same four tabs; what differs is only
// what a promoter chooses to create: a private event (guestlist night) or a
// public offer listed on the consumer app. Both show up side by side in
// Tonight and Guestlist.
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
                .tabItem { Label("Stats", systemImage: "chart.bar") }
                .tag(Tab.earnings)

            NavigationStack { YouView() }
                .tabItem { Label("You", systemImage: "person") }
                .tag(Tab.you)
        }
        .tint(Theme.ember)
        .toolbarBackground(Theme.night, for: .tabBar)
        .task {
            // Push: prompt (first time) + register, and store the APNs token
            // so review outcomes can reach this promoter.
            PushManager.shared.enable()
        }
    }
}

/// Guestlist tab without a specific allocation just lists the user's nights
/// and lets them pick one. Same view as Tonight but framed differently.
struct GuestlistTabRoot: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model = TonightModel()
    @State private var showCreateChooser = false
    @State private var showCreate = false          // private event form
    @State private var showOfferClubPicker = false // public offer: pick venue
    @State private var creatingOfferClub: UUID?    // public offer: form
    @StateObject private var offers = SupplierHomeModel()
    @State private var detailOffer: SupplierOffer?
    @State private var editingOffer: SupplierOffer?
    @State private var navigateTo: PromoterAllocation?
    @State private var seriesOccurrence: SeriesOccurrence?
    @State private var pendingDelete: PromoterAllocation?
    @State private var pendingDeleteSeries: PromoterSeries?
    @State private var editingAllocation: PromoterAllocation?
    @State private var editingSeries: PromoterSeries?
    @State private var detailAllocation: PromoterAllocation?
    @State private var detailSeries: PromoterSeries?
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
                        showCreateChooser = true
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
                            Button { Haptics.tap(); detailSeries = s } label: {
                                SeriesRow(series: s)
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button { editingSeries = s } label: {
                                    Label("Edit series", systemImage: "pencil")
                                }
                            }
                        }
                    }
                    Text("Tap a link for guests, skipped weeks, and options. Edits are re-reviewed before going live.")
                        .font(.cfMono(10))
                        .kerning(1.5)
                        .foregroundStyle(Theme.parchmentDim)
                        .padding(.top, 4)
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

                // No nights/series empty-state line: it only looked at nights and
                // series, so it claimed "nothing here" while sitting on top of a
                // full list of public offers. The header + "+" are the guidance.
                if model.loading {
                    ProgressView().tint(Theme.parchment).padding(.top, 40)
                } else if !model.allocations.isEmpty {
                    Text("Tap a night for guests and options. Swipe left to delete, right to edit.")
                        .font(.cfMono(10))
                        .kerning(1.5)
                        .foregroundStyle(Theme.parchmentDim)
                        .padding(.top, 4)
                    List {
                        ForEach(model.allocations) { a in
                            Button { Haptics.tap(); detailAllocation = a } label: {
                                GuestlistRow(allocation: a)
                            }
                            .buttonStyle(.plain)
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
                            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                Button {
                                    editingAllocation = a
                                } label: {
                                    Label("Edit", systemImage: "pencil")
                                }
                                .tint(Theme.ember)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Theme.night)
                    .frame(minHeight: listHeight)
                }

                publicOffersSection

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
            await offers.load()
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                await model.load()
            }
        }
        .onAppear { Task { await model.load() } }
        .onReceive(NotificationCenter.default.publisher(for: .reviewOutcomeReceived)) { _ in
            Task { await model.load() }
        }
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
        .sheet(isPresented: $showCreateChooser) {
            CreateTypeChooser { kind in
                showCreateChooser = false
                afterSheetDismiss {
                    switch kind {
                    case .privateEvent: showCreate = true
                    case .publicOffer:  showOfferClubPicker = true
                    }
                }
            }
        }
        .sheet(isPresented: $showOfferClubPicker) {
            SupplierClubPicker(clubs: offers.clubs) { picked in
                showOfferClubPicker = false
                afterSheetDismiss { creatingOfferClub = picked }
            }
        }
        .sheet(isPresented: Binding(get: { creatingOfferClub != nil },
                                    set: { if !$0 { creatingOfferClub = nil } })) {
            if let cid = creatingOfferClub {
                SupplierOfferSheet(model: offers, existing: nil, clubId: cid) {
                    await offers.load()
                }
            }
        }
        .sheet(item: $editingOffer) { offer in
            SupplierOfferSheet(model: offers, existing: offer, clubId: offer.clubId) {
                await offers.load()
            }
        }
        .sheet(item: $detailOffer) { offer in
            SupplierOfferDetailSheet(
                offer: offer,
                clubName: offers.clubName(offer.clubId),
                onEdit: { afterSheetDismiss { editingOffer = offer } },
                onToggle: { Task { await offers.setActive(offer, !offer.isActive) } },
                onDelete: { Task { await offers.delete(offer) } },
                onChanged: { Task { await offers.load() } })
                .presentationBackground(Theme.night)
        }
        .alert("Submitted for review", isPresented: $offers.reviewNotice) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Your change will be reviewed and approved by Club Fuoco within 3 business days. It goes live once approved.")
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
                        case .pending: break   // held for review — just refresh
                        }
                    }
                }
                .presentationBackground(Theme.night)
            }
        }
        .sheet(item: $editingAllocation) { a in
            if case .signedIn(let p) = auth.state {
                CreateGuestlistSheet(promoterId: p.id, editing: .night(a)) { _ in
                    editingAllocation = nil
                    Task { await model.load() }
                }
                .presentationBackground(Theme.night)
            }
        }
        .sheet(item: $editingSeries) { s in
            if case .signedIn(let p) = auth.state {
                CreateGuestlistSheet(promoterId: p.id, editing: .series(s)) { _ in
                    editingSeries = nil
                    Task { await model.load() }
                }
                .presentationBackground(Theme.night)
            }
        }
        .sheet(item: $detailAllocation) { a in
            NightDetailSheet(
                allocation: a,
                onOpenList: { afterSheetDismiss { navigateTo = a } },
                onEdit: { afterSheetDismiss { editingAllocation = a } },
                onDelete: { afterSheetDismiss { pendingDelete = a } },
                onChanged: { Task { await model.load() } })
                .presentationBackground(Theme.night)
        }
        .sheet(item: $detailSeries) { s in
            SeriesDetailSheet(
                series: s,
                onOpenWeek: { afterSheetDismiss { Task { await openSeries(s) } } },
                onEdit: { afterSheetDismiss { editingSeries = s } },
                onDelete: { afterSheetDismiss { pendingDeleteSeries = s } },
                onChanged: { Task { await model.load() } })
                .presentationBackground(Theme.night)
        }
        .navigationDestination(item: $seriesOccurrence) { occ in
            GuestlistView(allocation: occ.allocation, shareTokenOverride: occ.token, seriesId: occ.seriesId)
        }
        }
        .background(Theme.night.ignoresSafeArea())
        .alert("Delete this permanent link?",
               isPresented: Binding(get: { pendingDeleteSeries != nil },
                                    set: { if !$0 { pendingDeleteSeries = nil } })) {
            Button("Cancel", role: .cancel) { pendingDeleteSeries = nil }
            Button("Delete", role: .destructive) {
                if let target = pendingDeleteSeries { Task { await deleteSeries(target) } }
            }
        } message: {
            if let s = pendingDeleteSeries {
                Text("\(s.displayTitle) and its permanent invite link stop working immediately. This can't be undone.")
            }
        }
    }

    /// The promoter's PUBLIC offers, listed under their private nights — same
    /// tab, same promoter, just the other thing they can create.
    @ViewBuilder
    private var publicOffersSection: some View {
        if !offers.offers.isEmpty {
            HStack {
                Kicker("Public offers", color: Theme.parchmentDim)
                Spacer()
                Text("Listed on the Fuoco app")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
            .padding(.top, 20)

            VStack(spacing: 12) {
                ForEach(offers.byClub, id: \.club) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        Kicker(offers.clubName(group.club).uppercased(), color: Theme.flame, size: 9)
                        ForEach(group.offers) { offer in
                            Button { Haptics.tap(); detailOffer = offer } label: {
                                PublicOfferRow(offer: offer)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    /// Run after the currently-presented detail sheet finishes dismissing —
    /// presenting a new sheet/alert/navigation in the same tick gets dropped.
    private func afterSheetDismiss(_ action: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: action)
    }

    private func deleteSeries(_ s: PromoterSeries) async {
        deleting = true
        defer { deleting = false; pendingDeleteSeries = nil }
        do {
            try await PromoterRepo().deleteSeries(seriesId: s.id)
            Haptics.success()
            await model.load()
        } catch {
            Haptics.error()
        }
    }

    private var headerInitials: String {
        if case .signedIn(let p) = auth.state {
            return String(p.displayName.prefix(1)).uppercased()
        }
        return ""
    }

    /// Row estimate for the embedded List — rejected rows carry an inline
    /// rejection notice and need extra room.
    private var listHeight: CGFloat {
        let rejected = model.allocations.filter { $0.night?.reviewState == .rejected }.count
        return CGFloat(model.allocations.count) * 84 + CGFloat(rejected) * 84 + 20
    }

    private func openSeries(_ s: PromoterSeries) async {
        opening = true
        defer { opening = false }
        if let alloc = try? await PromoterRepo().currentAllocation(forSeries: s.id) {
            seriesOccurrence = SeriesOccurrence(allocation: alloc, token: s.inviteToken, seriesId: s.id)
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
    let seriesId: UUID
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
                if let state = series.reviewState {
                    ReviewBadge(state: state)
                } else {
                    Text("ACTIVE")
                        .font(.cfMono(9, weight: .medium)).kerning(1.5)
                        .foregroundStyle(Theme.emberCream)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(Theme.ember))
                }
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
            if series.reviewState == .rejected {
                RejectionNotice(reason: series.rejectionReason)
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
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(title)
                            .font(.cfSerif(20))
                            .foregroundStyle(Theme.parchment)
                        if let state = allocation.night?.reviewState { ReviewBadge(state: state) }
                    }
                    Text(subtitle)
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchmentDim)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(Theme.parchmentDim)
            }
            if allocation.night?.reviewState == .rejected {
                RejectionNotice(reason: allocation.night?.rejectionReason)
            }
        }
        .padding(.vertical, 16)
        .contentShape(Rectangle())
    }
}

#Preview { RootView() }
