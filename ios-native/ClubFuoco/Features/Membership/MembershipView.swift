import SwiftUI
import StoreKit

/// Membership plans — tier cards with perks, StoreKit 2 subscribe, restore,
/// and manage-subscription. Real prices come from StoreKit when products are
/// configured; the catalogue's display labels are the fallback.
struct MembershipView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(MembershipStore.self) private var store
    @State private var showManage = false
    @State private var grantedTier: String?

    private static let tiers: [(key: String, fallbackPrice: String, perkCount: Int)] = [
        ("gold", "€19", 4),
        ("sapphire", "€49", 4),
        ("black", "€500", 6),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Current plan
                let current = auth.profile?.membershipTier ?? "free"
                HStack(spacing: 8) {
                    Kicker(locale.t("membership.current"), color: Theme.fadedSand, size: 9)
                    Text(TierStyle.for(current).label)
                        .font(.cfSerif(16, italic: true))
                        .foregroundStyle(Theme.wine)
                }

                if let grantedTier {
                    Label(String(format: locale.t("membership.active"), TierStyle.for(grantedTier).label), systemImage: "checkmark.seal.fill")
                        .font(.cfSans(13, weight: .medium))
                        .foregroundStyle(Color(hex: 0x2D7A46))
                }

                if let error = store.errorMessage {
                    FormError(message: error)
                }

                ForEach(Self.tiers, id: \.key) { tier in
                    tierCard(tier.key, fallbackPrice: tier.fallbackPrice, perkCount: tier.perkCount, current: current)
                }

                if store.products.isEmpty {
                    Text(locale.t("membership.unavailable"))
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.fadedSand)
                        .frame(maxWidth: .infinity)
                }

                Button {
                    Task {
                        if let tier = await store.restore() {
                            grantedTier = tier
                            await auth.refreshProfile()
                        } else if store.errorMessage == nil {
                            store.errorMessage = locale.t("membership.noRestore")
                        }
                    }
                } label: {
                    Text(locale.t("membership.restore"))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.stone)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }

                if current != "free" {
                    Button {
                        showManage = true
                    } label: {
                        Text(locale.t("membership.manage"))
                            .font(.cfSans(13, weight: .medium))
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.cream)
        .navigationTitle(locale.t("profile.membership"))
        .navigationBarTitleDisplayMode(.inline)
        .manageSubscriptionsSheet(isPresented: $showManage)
        .task {
            store.start()
            await store.loadProducts()
        }
    }

    private func tierCard(_ key: String, fallbackPrice: String, perkCount: Int, current: String) -> some View {
        let style = TierStyle.for(key)
        let product = store.products.first { $0.id.hasSuffix(key) }
        let isCurrent = current == key

        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(style.label)
                    .font(.cfSerif(28, italic: true))
                    .foregroundStyle(style.accent)
                Spacer()
                Text(product?.displayPrice ?? fallbackPrice)
                    .font(.cfSerif(22))
                    .foregroundStyle(style.accent)
                Text(locale.t("membership.perMonth"))
                    .font(.cfSans(11))
                    .foregroundStyle(style.soft)
            }

            VStack(alignment: .leading, spacing: 6) {
                ForEach(1...perkCount, id: \.self) { i in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "flame.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(style.accent.opacity(0.7))
                            .padding(.top, 3)
                        Text(locale.t("perk.\(key).\(i)"))
                            .font(.cfSans(12.5))
                            .foregroundStyle(style.nameColor.opacity(0.9))
                    }
                }
            }

            if isCurrent {
                Kicker(locale.t("membership.current"), color: style.accent, size: 9)
                    .padding(.vertical, 8)
            } else if let product {
                Button {
                    Haptics.tap()
                    Task {
                        if let tier = await store.purchase(product) {
                            grantedTier = tier
                            await auth.refreshProfile()
                        }
                    }
                } label: {
                    Text(store.purchasing ? locale.t("membership.verifying") : locale.t("membership.subscribe"))
                        .font(.cfSans(14, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .background(.white.opacity(0.16), in: .rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(style.accent.opacity(0.4)))
                        .foregroundStyle(style.accent)
                }
                .disabled(store.purchasing)
            }
        }
        .padding(18)
        .background(
            LinearGradient(colors: style.gradient, startPoint: .topLeading, endPoint: .bottomTrailing),
            in: .rect(cornerRadius: Theme.radiusCard)
        )
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(style.border))
    }
}
