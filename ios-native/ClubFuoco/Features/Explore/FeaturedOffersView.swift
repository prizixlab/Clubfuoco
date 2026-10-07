import SwiftUI

/// Everything in the featured box, as a list — pushed by the box's
/// "N offers · M bookable →" chip.
///
/// The chip used to say "3 venues", counting only the shelf's venue list while
/// the box itself showed the desk's picks, the hero and the night's events —
/// and its NavigationLink sat against the hero card, which claimed the tap.
struct FeaturedOffers: Hashable {
    let items: [FeaturedItem]
    /// The planned night the offers are for (yyyy-MM-dd).
    let date: String

    @MainActor var bookableCount: Int { items.filter { $0.isBookable(on: date) }.count }
}

extension FeaturedItem {
    /// Can a guest book or buy this from the app for `date`? A venue with a
    /// live guestlist / VIP offer or a Fourvenues night; an event that sells,
    /// reserves, or has a Fourvenues way in — and isn't sold out.
    @MainActor func isBookable(on date: String) -> Bool {
        switch self {
        case .place(let p):
            return !RumbalistOffers.live(for: p.placeId, on: date).isEmpty
                || FVCatalog.shared.upcoming(clubId: p.placeId).contains { $0.night == date }
        case .event(let e):
            guard !e.soldOut else { return false }
            return e.isTicketed || e.clubId != nil || !FVTier.offered(in: e.fvRooms).isEmpty
        }
    }
}

/// Pushes the offers list onto the Explore stack — through the environment
/// for the same reason as pushPlace: a NavigationLink beside a full-card tap
/// target loses its taps to the card.
private struct PushFeaturedOffersKey: EnvironmentKey {
    static let defaultValue: (FeaturedOffers) -> Void = { _ in }
}
extension EnvironmentValues {
    var pushFeaturedOffers: (FeaturedOffers) -> Void {
        get { self[PushFeaturedOffersKey.self] }
        set { self[PushFeaturedOffersKey.self] = newValue }
    }
}

struct FeaturedOffersView: View {
    let offers: FeaturedOffers
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @Environment(\.pushPlace) private var pushPlace

    /// Bookable first, otherwise in the box's own order.
    private var ordered: [FeaturedItem] {
        let b = offers.items.filter { $0.isBookable(on: offers.date) }
        return b + offers.items.filter { !$0.isBookable(on: offers.date) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(locale.t("explore.featured"))
                        .font(.cfSerif(38, italic: true))
                        .foregroundStyle(Theme.ink)
                    Text(countLine)
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.fadedSand)
                }
                .padding(.init(top: 6, leading: 20, bottom: 22, trailing: 20))

                VStack(spacing: 14) {
                    ForEach(ordered) { item in row(item) }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
        }
        .background(Theme.cream)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 44, height: 44)
                }
                Spacer()
            }
            .padding(.horizontal, 8)
            .background(Theme.cream)
        }
    }

    private var countLine: String {
        "\(String(format: locale.t("explore.offersCount"), offers.items.count)) · "
            + String(format: locale.t("explore.bookableCount"), offers.bookableCount)
    }

    @ViewBuilder private func row(_ item: FeaturedItem) -> some View {
        switch item {
        case .place(let p):
            rowBody(image: p.coverPhoto ?? p.photos.first, title: p.name,
                    subtitle: p.neighborhood ?? p.address, bookable: item.isBookable(on: offers.date))
                .contentShape(.rect)
                .onTapGesture { pushPlace(p) }
        case .event(let e):
            NavigationLink(value: e) {
                rowBody(image: e.image ?? e.photoUrls?.first, title: e.displayTitle,
                        subtitle: e.metaLine(locale: locale), bookable: item.isBookable(on: offers.date))
            }
            .buttonStyle(.plain)
        }
    }

    private func rowBody(image: String?, title: String, subtitle: String, bookable: Bool) -> some View {
        HStack(spacing: 14) {
            AsyncImage(url: image.flatMap(URL.init(string:))) { phase in
                if let img = phase.image { img.resizable().scaledToFill() }
                else { Theme.ink.opacity(0.08) }
            }
            .frame(width: 64, height: 64)
            .clipShape(.rect(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.cfSans(15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.cfSans(12.5))
                    .foregroundStyle(Theme.fadedSand)
                    .lineLimit(1)
                if bookable {
                    Text(locale.t("explore.bookableTag").uppercased())
                        .font(.cfMono(8.5)).kerning(1.2)
                        .foregroundStyle(Theme.gold)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .overlay(Capsule().stroke(Theme.gold.opacity(0.6), lineWidth: 1))
                        .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.ink.opacity(0.3))
        }
        .padding(12)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
    }
}
