import SwiftUI

// Public-offer data + venue picker, shared by the unified Guestlist tab.
// Promoters and suppliers are ONE role: any promoter can publish public
// offers, and their partner_brand is provisioned on their first one — so
// there is no separate "supplier" screen any more.

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

/// Compact public-offer row for the unified Guestlist tab, sitting under the
/// promoter's private nights. Tap opens SupplierOfferDetailSheet (bookings +
/// actions); the review badge mirrors the private-night rows.
struct PublicOfferRow: View {
    let offer: SupplierOffer

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(Theme.ember.opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: offer.isVip ? "wineglass" : "list.bullet.rectangle")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.ember)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(offer.title)
                        .font(.cfSans(15, weight: .medium))
                        .foregroundStyle(Theme.parchment)
                        .lineLimit(1)
                    if !offer.isActive {
                        Text("INACTIVE")
                            .font(.cfMono(8, weight: .medium)).kerning(1.2)
                            .foregroundStyle(Theme.parchmentDim)
                    }
                }
                Text(offer.validDays)
                    .font(.cfSans(11))
                    .foregroundStyle(Theme.parchmentDim)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(offer.isVip ? "€\(Int(offer.priceEur ?? 0))" : "FREE")
                .font(.cfMono(10, weight: .medium)).kerning(0.5)
                .foregroundStyle(offer.isVip ? Theme.flame : Theme.ember)
            Image(systemName: "chevron.right")
                .font(.system(size: 11))
                .foregroundStyle(Theme.parchmentDim)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
        .opacity(offer.isActive ? 1 : 0.6)
        .contentShape(Rectangle())
    }
}

struct SupplierClubPicker: View {
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
