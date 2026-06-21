import SwiftUI
import Observation

/// Native port of the Fiamme (points) page: balance hero, tier ladder
/// (progress by verified reviews), rewards with redeem → one-use code,
/// how-to-earn, and the activity ledger.
struct FiammeView: View {
    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @State private var model = FiammeViewModel()
    @State private var confirmReward: FiammeReward?
    @State private var redeemedCode: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                balanceCard
                tierLadder
                rewards
                earnWays
                activity
            }
            .padding(20)
        }
        .background(Theme.cream)
        .navigationTitle("Fiamme")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(api: api) }
        .refreshable { await model.load(api: api) }
        .confirmationDialog(
            confirmReward.map { String(format: locale.t("fiamme.redeemQuestion"), locale.t("fiamme.reward.\($0.key)"), $0.cost) } ?? "",
            isPresented: Binding(get: { confirmReward != nil }, set: { if !$0 { confirmReward = nil } }),
            titleVisibility: .visible
        ) {
            Button(locale.t("fiamme.redeem")) {
                if let reward = confirmReward {
                    model.redeem(reward, api: api) { redeemedCode = $0 }
                }
                confirmReward = nil
            }
            Button(locale.t("common.cancel"), role: .cancel) { confirmReward = nil }
        }
        .sheet(isPresented: Binding(get: { redeemedCode != nil }, set: { if !$0 { redeemedCode = nil } })) {
            codeSheet
        }
    }

    // ── Balance ───────────────────────────────────────────────────────────────

    private var balanceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(locale.t("fiamme.balanceSection"), color: Theme.parchment.opacity(0.5), size: 9)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.flame)
                Text("\(model.data?.balance ?? 0)")
                    .font(.cfSerif(54))
                    .foregroundStyle(Theme.parchment)
            }
            Text(String(format: locale.t("fiamme.available"), "\(model.data?.balance ?? 0)"))
                .font(.cfSerif(15, italic: true))
                .foregroundStyle(Theme.parchment.opacity(0.7))
            HStack(spacing: 6) {
                Text(model.tier.label)
                    .font(.cfSerif(14, italic: true))
                    .foregroundStyle(Theme.flame)
                Text("· \(locale.t("fiamme.tier.\(model.tier.key)")) · \(model.tier.mult)")
                    .font(.cfSans(11))
                    .foregroundStyle(Theme.parchment.opacity(0.6))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(.white.opacity(0.08), in: .capsule)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(
            LinearGradient(colors: [Theme.night, Color(hex: 0x2A1810), Color(hex: 0x5B1F1C)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: .rect(cornerRadius: Theme.radiusCard)
        )
    }

    // ── Tier ladder ───────────────────────────────────────────────────────────

    private var tierLadder: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(locale.t("fiamme.tierSection"), color: Theme.fadedSand, size: 9)
            VStack(spacing: 0) {
                ForEach(Array(FiammeTier.all.enumerated()), id: \.element.key) { i, tier in
                    let isActive = tier.key == model.tier.key
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tier.label)
                                .font(.cfSerif(17, italic: isActive))
                                .foregroundStyle(isActive ? Theme.wine : Theme.ink)
                            Text(locale.t("fiamme.tier.\(tier.key)"))
                                .font(.cfSans(10))
                                .foregroundStyle(Theme.fadedSand)
                        }
                        Spacer()
                        Text(String(format: locale.t("detail.reviews"), tier.min))
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.fadedSand)
                        Text(tier.mult)
                            .font(.cfSans(12, weight: .semibold))
                            .foregroundStyle(isActive ? Theme.wine : Theme.stone)
                            .frame(width: 40, alignment: .trailing)
                    }
                    .padding(.vertical, 10)
                    .padding(.horizontal, 14)
                    .background(isActive ? Theme.wine.opacity(0.05) : .clear)
                    if i < FiammeTier.all.count - 1 {
                        Divider().overlay(Theme.hairline)
                    }
                }
            }
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
        }
    }

    // ── Rewards ───────────────────────────────────────────────────────────────

    private var rewards: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(locale.t("fiamme.rewardsSection"), color: Theme.fadedSand, size: 9)
            ZStack {
                // Blurred placeholder reward rows (no real titles shown).
                VStack(spacing: 10) {
                    ForEach(0..<3, id: \.self) { _ in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 6) {
                                Capsule()
                                    .fill(Theme.ink.opacity(0.25))
                                    .frame(width: 160, height: 14)
                                Capsule()
                                    .fill(Theme.fadedSand.opacity(0.45))
                                    .frame(width: 220, height: 10)
                            }
                            Spacer()
                            Capsule()
                                .fill(Theme.wine.opacity(0.25))
                                .frame(width: 56, height: 24)
                        }
                        .padding(14)
                        .background(Color.white, in: .rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                    }
                }
                .blur(radius: 8)
                .allowsHitTesting(false)
                .accessibilityHidden(true)

                // Coming-soon card centered on the blur.
                VStack(spacing: 6) {
                    Text(comingSoonLabel)
                        .font(.cfSans(11, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(Theme.wine)
                    Text(comingSoonSubtitle)
                        .font(.cfSerif(15, italic: true))
                        .foregroundStyle(Theme.ink.opacity(0.7))
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 16)
                .background(Theme.cream, in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.wine.opacity(0.25)))
                .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
            }
        }
    }

    private var comingSoonLabel: String {
        locale.locale == "es" ? "PRÓXIMAMENTE" : "COMING SOON"
    }

    private var comingSoonSubtitle: String {
        locale.locale == "es"
            ? "Las recompensas llegarán pronto."
            : "Rewards are on the way."
    }

    // ── Earn ways ─────────────────────────────────────────────────────────────

    private var earnWays: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(locale.t("fiamme.earnSection"), color: Theme.fadedSand, size: 9)
            VStack(alignment: .leading, spacing: 12) {
                earnRow("01", pts: "+10", key: "fiamme.earn1")
                earnRow("02", pts: "+50", key: "fiamme.earn2")
                earnRow("03", pts: "+30", key: "fiamme.earn3")
            }
            .padding(14)
            .background(Color.white, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
        }
    }

    private func earnRow(_ n: String, pts: String, key: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Kicker(n, color: Theme.fadedSand, size: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(locale.t(key))
                    .font(.cfSerif(16))
                    .foregroundStyle(Theme.ink)
                Text(locale.t("\(key).desc"))
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.fadedSand)
            }
            Spacer()
            Text(pts)
                .font(.cfSans(13, weight: .semibold))
                .foregroundStyle(Theme.wine)
        }
    }

    // ── Activity ──────────────────────────────────────────────────────────────

    private var activity: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(locale.t("fiamme.activitySection"), color: Theme.fadedSand, size: 9)
            if (model.data?.activity ?? []).isEmpty {
                Text(locale.t("fiamme.noActivity"))
                    .font(.cfSerif(14, italic: true))
                    .foregroundStyle(Theme.fadedSand)
            } else {
                VStack(spacing: 0) {
                    ForEach(model.data?.activity ?? []) { item in
                        HStack {
                            Text(item.description ?? item.type ?? "—")
                                .font(.cfSans(13))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                            Spacer()
                            Text(item.amount > 0 ? "+\(item.amount)" : "\(item.amount)")
                                .font(.cfSans(13, weight: .semibold))
                                .foregroundStyle(item.amount > 0 ? Color(hex: 0x2D7A46) : Theme.wine)
                        }
                        .padding(.vertical, 10)
                        Divider().overlay(Theme.hairline)
                    }
                }
            }
        }
    }

    private var codeSheet: some View {
        VStack(spacing: 18) {
            Kicker("FIAMME", color: Theme.wine)
                .padding(.top, 32)
            Text(redeemedCode ?? "")
                .font(.cfSerif(36))
                .kerning(2)
                .foregroundStyle(Theme.ink)
            if let code = redeemedCode {
                QRCodeView(token: code)
                    .frame(width: 200, height: 200)
                    .padding(16)
                    .background(Color.white, in: .rect(cornerRadius: 16))
            }
            Text(locale.t("fiamme.showCode"))
                .font(.cfSerif(15, italic: true))
                .foregroundStyle(Theme.stone)
            Kicker(locale.t("fiamme.expires"), color: Theme.fadedSand, size: 9)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(Theme.cream)
        .presentationDetents([.large])
    }
}

@MainActor
@Observable
final class FiammeViewModel {
    private(set) var data: FiammeData?
    private(set) var redeeming = false
    var errorMessage: String?

    var tier: FiammeTier {
        FiammeTier.current(reviews: data?.reviewCount ?? 0)
    }

    func load(api: APIClient) async {
        data = try? await api.get("/api/fiamme")
    }

    func redeem(_ reward: FiammeReward, api: APIClient, onCode: @escaping (String) -> Void) {
        redeeming = true
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable { let rewardKey: String }
                let result: FiammeRedeemResult = try await api.post("/api/fiamme/redeem", body: Body(rewardKey: reward.key))
                Haptics.success()
                onCode(result.code)
                await load(api: api)
            } catch {
                Haptics.error()
                errorMessage = error.localizedDescription
            }
            redeeming = false
        }
    }
}
