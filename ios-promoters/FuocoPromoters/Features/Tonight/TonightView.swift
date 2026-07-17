import SwiftUI

@MainActor
final class TonightModel: ObservableObject {
    @Published var allocations: [PromoterAllocation] = []
    @Published var series: [PromoterSeries] = []
    @Published var loading = true
    @Published var error: String?

    let repo = PromoterRepo()

    func load() async {
        loading = true; error = nil
        do {
            async let a = repo.myAllocations()
            async let s = repo.mySeries()
            allocations = try await a
            series = (try? await s) ?? []
        } catch {
            self.error = "Couldn't load your nights."
        }
        loading = false
    }

    var todays: PromoterAllocation? {
        let today = Self.dateFormatter.string(from: Date())
        return allocations.first { $0.night?.nightDate == today }
    }

    var upcoming: [PromoterAllocation] {
        let today = Self.dateFormatter.string(from: Date())
        return allocations.filter { ($0.night?.nightDate ?? "") > today }
    }

    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

struct TonightView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model = TonightModel()
    @State private var detailAllocation: PromoterAllocation?
    @State private var navigateTo: PromoterAllocation?
    @State private var editingAllocation: PromoterAllocation?
    @State private var pendingDelete: PromoterAllocation?
    // The promoter's PUBLIC offers — same tab as their private nights.
    @StateObject private var offers = SupplierHomeModel()
    @State private var detailOffer: SupplierOffer?

    /// 0 = Sunday … 6 = Saturday, matching ValidDays' indices.
    private var todayIndex: Int { Calendar.current.component(.weekday, from: Date()) - 1 }

    /// Active public offers whose valid_days cover tonight.
    private var offersTonight: [SupplierOffer] {
        offers.offers.filter { $0.isActive && ValidDays.parse($0.validDays).contains(todayIndex) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header

                if model.loading {
                    ProgressView().tint(Theme.parchment).padding(.top, 40)
                } else if let err = model.error {
                    Text(err).font(.cfSans(14)).foregroundStyle(Theme.wine)
                } else {
                    if let tonight = model.todays {
                        featured(tonight)
                    } else {
                        emptyTonight
                    }

                    if !offersTonight.isEmpty {
                        HStack {
                            Kicker("Your public offers tonight")
                            Spacer()
                            Text("Live on the Fuoco app")
                                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                        }
                        .padding(.top, 8)
                        VStack(spacing: 10) {
                            ForEach(offersTonight) { offer in
                                Button { Haptics.tap(); detailOffer = offer } label: {
                                    PublicOfferRow(offer: offer)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if !model.upcoming.isEmpty {
                        Kicker("Upcoming this week").padding(.top, 8)
                        VStack(spacing: 0) {
                            ForEach(model.upcoming) { a in
                                Button { Haptics.tap(); detailAllocation = a } label: {
                                    upcomingRow(a)
                                }
                                .buttonStyle(.plain)
                                Divider().background(Theme.hairline)
                            }
                        }
                    }
                }

                Spacer(minLength: 80)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
        }
        .background(Theme.night)
        .task {
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                await model.load()
            }
        }
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
        .sheet(item: $detailOffer) { offer in
            SupplierOfferDetailSheet(
                offer: offer,
                clubName: offers.clubName(offer.clubId),
                onToggle: { Task { await offers.setActive(offer, !offer.isActive) } })
                .presentationBackground(Theme.night)
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
        .sheet(item: $editingAllocation) { a in
            if case .signedIn(let p) = auth.state {
                CreateGuestlistSheet(promoterId: p.id, editing: .night(a)) { _ in
                    editingAllocation = nil
                    Task { await model.load() }
                }
                .presentationBackground(Theme.night)
            }
        }
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
    }

    /// Run after the detail sheet finishes dismissing — presenting a new
    /// sheet/alert/navigation in the same tick gets dropped.
    private func afterSheetDismiss(_ action: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: action)
    }

    private func delete(_ a: PromoterAllocation) async {
        defer { pendingDelete = nil }
        do {
            try await PromoterRepo().deleteAllocation(allocationId: a.id)
            Haptics.success()
            await model.load()
        } catch {
            Haptics.error()
        }
    }

    private var header: some View {
        HStack {
            if case .signedIn(let p) = auth.state {
                Text("Hola, \(p.displayName)")
                    .font(.cfSerif(22))
                    .foregroundStyle(Theme.parchment)
            }
            Spacer()
            Image(systemName: "bell")
                .foregroundStyle(Theme.flame)
                .font(.system(size: 18))
        }
    }

    private var emptyTonight: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Tonight")
                .font(.cfSerif(48))
                .foregroundStyle(Theme.parchment)
            Text("No night assigned to you tonight.")
                .font(.cfSans(15))
                .foregroundStyle(Theme.parchmentDim)
        }
    }

    private func featured(_ a: PromoterAllocation) -> some View {
        let n = a.night
        return VStack(alignment: .leading, spacing: 16) {
            Text("Tonight")
                .font(.cfSerif(48))
                .foregroundStyle(Theme.parchment)
            Text(formattedDate(n?.nightDate))
                .font(.cfSerif(18, italic: true))
                .foregroundStyle(Theme.parchmentDim)

            Button { Haptics.tap(); detailAllocation = a } label: {
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: Theme.radiusCard)
                        .fill(LinearGradient(
                            colors: [Theme.nightLift, Theme.ember.opacity(0.35)],
                            startPoint: .top, endPoint: .bottom))
                        .frame(height: 220)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            Kicker("Currently featured")
                            if let state = n?.reviewState { ReviewBadge(state: state) }
                        }
                        HStack(alignment: .lastTextBaseline) {
                            Text(n?.displayTitle ?? "Tonight")
                                .font(.cfSerif(34))
                                .foregroundStyle(Theme.parchment)
                            Spacer()
                            Capsule().fill(Theme.ember)
                                .frame(width: 120, height: 32)
                                .overlay(
                                    Text("\(a.usedLabel) used")
                                        .font(.cfMono(11, weight: .medium))
                                        .foregroundStyle(Theme.emberCream))
                        }
                    }.padding(16)
                }
            }
            .buttonStyle(.plain)

            if n?.reviewState == .rejected {
                RejectionNotice(reason: n?.rejectionReason)
            }
        }
    }

    private func upcomingRow(_ a: PromoterAllocation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 14) {
                Text(shortDate(a.night?.nightDate))
                    .font(.cfMono(11, weight: .medium))
                    .foregroundStyle(Theme.flame)
                    .frame(width: 56, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(a.night?.displayTitle ?? "Night")
                            .font(.cfSerif(20))
                            .foregroundStyle(Theme.parchment)
                        if let state = a.night?.reviewState { ReviewBadge(state: state) }
                    }
                    Text(a.night?.club?.name ?? "—")
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchmentDim)
                }
                Spacer()
                Text(a.usedLabel)
                    .font(.cfMono(10))
                    .kerning(1.5)
                    .foregroundStyle(Theme.flame)
            }
            if a.night?.reviewState == .rejected {
                RejectionNotice(reason: a.night?.rejectionReason)
                    .padding(.leading, 70)
            }
        }
        .padding(.vertical, 16)
    }

    private func shortDate(_ s: String?) -> String {
        guard let s, let d = Self.iso.date(from: s) else { return "" }
        let f = DateFormatter(); f.dateFormat = "EEE d"
        return f.string(from: d).uppercased()
    }

    private func formattedDate(_ s: String?) -> String {
        guard let s, let d = Self.iso.date(from: s) else { return "" }
        let f = DateFormatter(); f.dateFormat = "EEEE, MMMM d"
        return f.string(from: d)
    }

    static let iso: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
}
