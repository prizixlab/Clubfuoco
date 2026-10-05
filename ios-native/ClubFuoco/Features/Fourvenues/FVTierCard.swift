import SwiftUI

extension FVTier {
    /// The rooms in `night` that sell this tier at all (sold out or not).
    func rooms(in night: [FVEvent]) -> [FVEvent] {
        night.filter { $0.products.contains(where: includes) }
    }

    /// The tiers `night` sells, in button order: free, paid, VIP.
    static func offered(in night: [FVEvent]) -> [FVTier] {
        allCases.filter { !$0.rooms(in: night).isEmpty }
    }
}

/// One HypeList way in — Free Guestlist / Paid entry / VIP tables — as the
/// club page and the event page both draw it. `rooms` is what this tier sells
/// on the night (FVTier.rooms(in:)); the caller opens FVEventSheet on tap.
struct FVTierCard: View {
    let tier: FVTier
    let rooms: [FVEvent]
    @Environment(LocaleStore.self) private var locale

    private var available: [FVProduct] {
        rooms.flatMap(\.products).filter { tier.includes($0) && !$0.soldOut }
    }

    /// Latest "entry before" among the open free lists.
    private var freeUntil: String? {
        available.compactMap { $0.window?.until ?? FVPerks($0.name).before }.max()
    }

    /// Cheapest still-available price in this tier.
    private var from: Double? {
        available.map { p in p.rates?.map(\.price).min() ?? p.price }.filter { $0 > 0 }.min()
    }

    var body: some View {
        let vip = tier == .vip
        let ink = Color(hex: 0x2A1B08)
        let fg = vip ? ink : Theme.ink
        let left = !available.isEmpty
        let title: String = switch tier {
        case .free: locale.t("fv.sectionFree")
        case .paid: locale.t("fv.tierPaid")
        case .vip: locale.t("fv.tierVip")
        }
        let subtitle: String = if !left { locale.t("fv.soldOut") } else {
            switch tier {
            case .free: freeUntil.map { String(format: locale.t("fv.tierFreeUntil"), $0) } ?? locale.t("fv.tierFreeSub")
            case .paid: from.map { String(format: locale.t("fv.tierPaidSub"), $0.euros) } ?? locale.t("fv.tierPaidSubNoPrice")
            case .vip: from.map { String(format: locale.t("fv.tierVipSub"), $0.euros) } ?? locale.t("fv.tierVipSubNoPrice")
            }
        }
        let icon = switch tier {
        case .free: "list.bullet.rectangle.fill"
        case .paid: "bolt.fill"
        case .vip: "wineglass.fill"
        }
        return HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(fg)
                .frame(width: 44, height: 44)
                .background(fg.opacity(vip ? 0.18 : 0.06), in: .rect(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(title)
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(fg)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text("with").font(.cfSans(11)).foregroundStyle(fg.opacity(0.75)).fixedSize()
                    SupplierMark(brand: FVCatalog.brand, height: 11, animated: false,
                                 tint: Color(hexString: FVCatalog.brand.color) ?? Theme.ember)
                        .layoutPriority(1)
                }
                Text(subtitle)
                    .font(.cfSans(12))
                    .foregroundStyle(vip ? ink.opacity(0.7) : Theme.stone)
                    .lineLimit(2)
            }
            Spacer(minLength: 6)
            Text(locale.t(tier == .free ? "rumbalist.join" : tier == .paid ? "fv.tierBuy" : "rumbalist.book"))
                .font(.cfSans(11, weight: .semibold))
                .foregroundStyle(fg.opacity(0.9))
                .fixedSize()
        }
        .padding(.init(top: 14, leading: 16, bottom: 14, trailing: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if vip {
                LinearGradient(colors: [Color(hex: 0xF5D8AE), Color(hex: 0xE7BC80), Color(hex: 0xCF9B54)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            } else {
                Theme.cream
            }
        }
        .clipShape(.rect(cornerRadius: 16))
        .opacity(left ? 1 : 0.5)
    }
}

// ── An event from our feed, matched to its HypeList night ─────────────────────

@MainActor
extension FeedEvent {
    /// HypeList's rooms at this event's club on its night.
    private var fvSameNight: [FVEvent] {
        guard let club = clubId?.lowercased() else { return [] }
        return FVCatalog.shared.events.filter { $0.clubId?.lowercased() == club && $0.night == nightDate }
    }

    /// The HypeList night this event IS. fourvenues_nights.py copies the
    /// Fourvenues name into `promoter_nights.title`, so the names match; a
    /// containment check covers a title the promoter has since tidied.
    var fvEvent: FVEvent? {
        guard let title = title.map(Self.fold), !title.isEmpty else { return nil }
        let night = fvSameNight
        return night.first { $0.name.map(Self.fold) == title }
            ?? night.first { n in n.name.map(Self.fold).map { $0.contains(title) || title.contains($0) } ?? false }
    }

    /// What its buttons sell: the matched night, or — when the title matches
    /// none of them — every HypeList room at the club that night, exactly as
    /// the club page offers it.
    var fvRooms: [FVEvent] {
        if let e = fvEvent { return [e] }
        return fvSameNight
    }

    /// The event's own poster. A night synced before it had a poster, or one
    /// whose row fell back to the venue photo, picks up HypeList's artwork.
    var posterURL: String? { fvEvent?.image ?? image }

    private static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .lowercased().filter { $0.isLetter || $0.isNumber }
    }
}
