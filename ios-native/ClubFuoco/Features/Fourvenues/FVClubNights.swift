import SwiftUI

/// A club's HypeList nights in "What's on", drawn like the club's own event
/// cards (date block, title, time) so they read as programming, not ads. Each
/// card carries the paid ways in as chips — pay at the door, ticket, table —
/// and opens the booking sheet with that way selected. Free lists are not
/// here: they are the club's Guestlist offer for that night.
struct FVClubNights: View {
    let clubId: String
    @Environment(LocaleStore.self) private var locale
    @State private var target: Target?

    struct Target: Identifiable {
        let event: FVEvent
        let product: FVProduct?
        var id: String { event.code + (product?.id ?? "") }
    }

    private var nights: [FVEvent] {
        FVCatalog.shared.upcoming(clubId: clubId).filter(hasPaidWay)
    }

    /// The colour of the brand selling a night — nights here can come from
    /// different Fourvenues sellers.
    private func accent(_ e: FVEvent) -> Color {
        Color(hexString: FVCatalog.shared.brand(for: e).color) ?? Theme.ember
    }

    var body: some View {
        VStack(spacing: 10) {
            ForEach(nights.prefix(6)) { card($0) }
        }
        .sheet(item: $target) { t in
            FVEventSheet(event: t.event, initial: t.product,
                         tier: t.product.flatMap { p in FVTier.allCases.first { $0.includes(p) } })
        }
    }

    /// Anything besides a free list: pay-at-door, tickets, tables.
    private func hasPaidWay(_ e: FVEvent) -> Bool {
        e.products.contains { $0.settle != .free && !$0.soldOut }
    }

    /// The cheapest available option of each kind — one chip per way in.
    private func cheapest(_ e: FVEvent, _ s: Settle) -> FVProduct? {
        e.products.filter { $0.settle == s && !$0.soldOut }.min { $0.price < $1.price }
    }

    private func card(_ e: FVEvent) -> some View {
        let parts = Self.dateParts(e.night)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                // Date block — same as the club's own event cards.
                VStack(spacing: 1) {
                    Text(parts.weekday).font(.cfMono(9)).kerning(1.2).foregroundStyle(Theme.gold)
                    Text(parts.day).font(.cfSans(22, weight: .bold)).foregroundStyle(Theme.ink)
                    Text(parts.month).font(.cfMono(9)).kerning(1).foregroundStyle(Theme.fadedSand)
                }
                .frame(width: 46)

                VStack(alignment: .leading, spacing: 6) {
                    Text(FVText.pretty(e.name) ?? "")
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) {
                        if let doors = e.doors {
                            Label([doors, e.closes].compactMap { $0 }.joined(separator: " – "), systemImage: "clock")
                        }
                        if let age = e.minAge { Text("\(age)+") }
                        SupplierMark(brand: FVCatalog.shared.brand(for: e), height: 9, animated: false, tint: accent(e))
                    }
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.fadedSand)
                    .lineLimit(1)
                    if !e.genres.isEmpty {
                        Text(e.genres.prefix(3).map { $0.capitalized }.joined(separator: " · "))
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.stone)
                    }
                }
                Spacer(minLength: 0)

                if let url = e.image.flatMap(URL.init(string:)) {
                    CachedAsyncImage(url: url, targetWidth: 160) {
                        $0.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: { Theme.surface }
                    .frame(width: 52, height: 68)
                    .clipShape(.rect(cornerRadius: 8))
                    // Taps only inside the visible frame — a .fill image's clipped-away overflow
                    // still hit-tests and steals taps from views above it on wider phones.
                    .contentShape(.rect(cornerRadius: 8))
                }
            }
            .padding(14)

            Rectangle().fill(Theme.hairline).frame(height: 1)

            // Ways in — one row, swipeable when a night has all three.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if let p = cheapest(e, .door) {
                        chip(String(format: locale.t("fv.atDoorAmount"), p.price.euros),
                             icon: "eurosign.circle", fill: Theme.ember, ink: .white, e, p)
                    }
                    if let p = cheapest(e, .online) {
                        chip(String(format: locale.t("fv.chipTickets"), p.price.euros),
                             icon: "ticket", fill: Theme.ink, ink: Theme.cream, e, p)
                    }
                    if let p = cheapest(e, .table) {
                        chip(p.price > 0 ? String(format: locale.t("fv.chipVip"), p.price.euros) : "VIP",
                             icon: "wineglass", fill: Theme.surface, ink: Theme.ink, e, p)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream)
        .clipShape(.rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
        .contentShape(.rect)
        .onTapGesture { Haptics.tap(); target = Target(event: e, product: nil) }
    }

    private func chip(_ title: String, icon: String, fill: Color, ink: Color,
                      _ e: FVEvent, _ p: FVProduct) -> some View {
        Button {
            Haptics.tap()
            target = Target(event: e, product: p)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold))
                Text(title).font(.cfSans(12, weight: .semibold)).lineLimit(1)
            }
            .fixedSize()
            .foregroundStyle(ink)
            .padding(.horizontal, 12).frame(height: 32)
            .background(fill, in: .capsule)
            .overlay(Capsule().stroke(Theme.hairline))
        }
        .buttonStyle(.plain)
    }

    /// "THU" / "1" / "OCT" in Barcelona time, like ClubEvent.dateParts.
    static func dateParts(_ ymd: String) -> (weekday: String, day: String, month: String) {
        let tz = TimeZone(identifier: "Europe/Madrid") ?? .current
        let p = DateFormatter(); p.dateFormat = "yyyy-MM-dd"; p.timeZone = tz; p.locale = Locale(identifier: "en_GB")
        guard let d = p.date(from: ymd) else { return ("", ymd, "") }
        let o = DateFormatter(); o.timeZone = tz; o.locale = Locale(identifier: "en_GB")
        o.dateFormat = "EEE"; let w = o.string(from: d).uppercased()
        o.dateFormat = "d"; let day = o.string(from: d)
        o.dateFormat = "MMM"
        return (w, day, o.string(from: d).uppercased())
    }
}
