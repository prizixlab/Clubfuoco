import SwiftUI

// Supplier home — the list's own guestlist offers, grouped by venue, with
// add / edit / deactivate / delete. Shown instead of the promoter tabs when the
// signed-in account owns a partner_brand (see RootView).

@MainActor
final class SupplierHomeModel: ObservableObject {
    @Published var brand: SupplierBrand?
    @Published var offers: [SupplierOffer] = []
    @Published var clubs: [SupplierClub] = []
    @Published var pending: [SupplierPending] = []
    @Published var loading = true
    @Published var error: String?
    @Published var reviewNotice = false   // set after a change is queued for review

    private let repo = SupplierRepo()

    func clubName(_ id: UUID) -> String {
        clubs.first { $0.id == id }?.name ?? "Venue"
    }

    /// Offers grouped by club, each group sorted, groups ordered by club name.
    var byClub: [(club: UUID, offers: [SupplierOffer])] {
        Dictionary(grouping: offers, by: \.clubId)
            .map { (club: $0.key, offers: $0.value.sorted { $0.sortOrder < $1.sortOrder }) }
            .sorted { clubName($0.club) < clubName($1.club) }
    }

    func load() async {
        do {
            async let b = repo.me()
            async let o = repo.offers()
            async let c = repo.clubs()
            brand = try await b
            offers = try await o
            clubs = try await c
            error = nil
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn’t load your offers."
        }
        pending = (try? await repo.pending()) ?? []
        loading = false
    }

    func setActive(_ offer: SupplierOffer, _ active: Bool) async {
        do { if try await repo.setActive(id: offer.id, active: active) { reviewNotice = true }; await load() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Update failed." }
    }

    func delete(_ offer: SupplierOffer) async {
        do { if try await repo.delete(id: offer.id) { reviewNotice = true }; await load() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Delete failed." }
    }
}

// The "Offers" tab content. Lives inside SupplierTabs' NavigationStack — no
// standalone NavigationStack/TabView of its own, so the app keeps its normal
// tab-bar chrome (sign-out moved to the Account tab).
struct SupplierHomeView: View {
    @StateObject private var model = SupplierHomeModel()
    @State private var editing: SupplierOffer?
    @State private var creatingClub: UUID?
    @State private var showClubPicker = false
    @State private var pendingDelete: SupplierOffer?

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            if model.loading {
                SupplierSkeleton(title: "Guestlist", subtitle: "All your offers, by venue")
            } else {
                content
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .sheet(item: $editing) { offer in
            SupplierOfferSheet(model: model, existing: offer, clubId: offer.clubId) { await model.load() }
        }
        .sheet(isPresented: Binding(get: { creatingClub != nil }, set: { if !$0 { creatingClub = nil } })) {
            if let cid = creatingClub {
                SupplierOfferSheet(model: model, existing: nil, clubId: cid) { await model.load() }
            }
        }
        .sheet(isPresented: $showClubPicker) {
            SupplierClubPicker(clubs: model.clubs) { picked in
                showClubPicker = false
                creatingClub = picked
            }
        }
        .alert("Delete this offer?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) { if let o = pendingDelete { Task { await model.delete(o) } } }
        } message: {
            Text("Deactivate instead if you just want to hide it — that keeps the offer’s details.")
        }
        .alert("Submitted for review", isPresented: $model.reviewNotice) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Your change will be reviewed and approved by Club Fuoco within 3 business days. It goes live once approved.")
        }
    }

    // Changes the supplier has submitted that are waiting on Club Fuoco.
    private var reviewCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "clock.badge").font(.system(size: 13)).foregroundStyle(Theme.ember)
                Text("IN REVIEW").font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.ember)
                Spacer()
                Text("~3 business days").font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
            }
            ForEach(model.pending) { p in
                Text(p.summary)
                    .font(.cfSans(13)).foregroundStyle(Theme.parchment)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.ember.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.ember.opacity(0.3)))
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Guestlist")
                            .font(.cfSerif(38)).foregroundStyle(Theme.parchment)
                        Text("All your offers, by venue")
                            .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                    }
                    Spacer()
                    Button {
                        Haptics.tap(); showClubPicker = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Theme.emberCream)
                            .frame(width: 52, height: 52)
                            .background(Circle().fill(Theme.ember))
                    }
                }
                .padding(.top, 8)

                if let error = model.error {
                    Text(error).font(.cfSans(13)).foregroundStyle(Theme.flame)
                }

                if !model.pending.isEmpty {
                    reviewCard
                }

                if model.offers.isEmpty {
                    Text("No offers yet. Tap + to add your first one at a venue.")
                        .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim).padding(.top, 24)
                }

                ForEach(model.byClub, id: \.club) { group in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Kicker(model.clubName(group.club).uppercased(), color: Theme.flame)
                            Spacer()
                            Button {
                                Haptics.tap(); creatingClub = group.club
                            } label: {
                                Text("Add").font(.cfMono(11, weight: .medium)).kerning(1.5)
                                    .foregroundStyle(Theme.ember)
                            }
                        }
                        ForEach(group.offers) { offer in
                            SupplierOfferRow(
                                offer: offer,
                                onEdit: { editing = offer },
                                onToggle: { Task { await model.setActive(offer, !offer.isActive) } },
                                onDelete: { pendingDelete = offer }
                            )
                        }
                    }
                }
                Spacer(minLength: 60)
            }
            .padding(20)
        }
        .refreshable { await model.load() }
    }
}

private struct SupplierOfferRow: View {
    let offer: SupplierOffer
    let onEdit: () -> Void
    let onToggle: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(offer.title).font(.cfSerif(20)).foregroundStyle(Theme.parchment)
                        Text(offer.isVip ? "VIP · €\(Int(offer.priceEur ?? 0))" : "FREE")
                            .font(.cfMono(10, weight: .medium)).kerning(1.2)
                            .foregroundStyle(offer.isVip ? Theme.flame : Theme.ember)
                        if !offer.isActive {
                            Text("INACTIVE").font(.cfMono(9, weight: .medium)).kerning(1.2)
                                .foregroundStyle(Theme.parchmentDim)
                        }
                    }
                    Text("\(offer.subtitle) · \(offer.validDays)")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                        .lineLimit(2)
                }
                Spacer()
            }
            HStack(spacing: 18) {
                Button { Haptics.tap(); onEdit() } label: {
                    Label("Edit", systemImage: "pencil").font(.cfSans(13)).foregroundStyle(Theme.parchment)
                }
                Button { Haptics.tap(); onToggle() } label: {
                    Label(offer.isActive ? "Deactivate" : "Reactivate",
                          systemImage: offer.isActive ? "eye.slash" : "eye")
                        .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                }
                Spacer()
                Button(role: .destructive) { Haptics.tap(); onDelete() } label: {
                    Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(Theme.flame)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.hairline))
        .opacity(offer.isActive ? 1 : 0.6)
    }
}

private struct SupplierClubPicker: View {
    let clubs: [SupplierClub]
    let onPick: (UUID) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var hits: [SupplierClub] {
        query.isEmpty ? clubs : clubs.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                List(hits) { club in
                    Button { onPick(club.id) } label: {
                        Text(club.name).font(.cfSans(15)).foregroundStyle(Theme.parchment)
                    }
                    .listRowBackground(Theme.night)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .searchable(text: $query, prompt: "Search venues")
            }
            .navigationTitle("Add a venue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { dismiss() } } }
        }
        .tint(Theme.ember)
    }
}
