import SwiftUI

// The "Stats" tab. A promoter's performance across BOTH things they run:
// private nights (payout tracking + attendance, from allocations) and public
// offers (bookings through the Fuoco app, from /api/offers/stats). Earnings is
// one section of it — an offers-only account (e.g. Rumba) has no payouts but
// plenty of bookings, and the old earnings-only page showed them nothing.

@MainActor
final class StatisticsModel: ObservableObject {
    @Published var allocations: [PromoterAllocation] = []
    @Published var stats: OfferStats = .empty
    @Published var clubNames: [UUID: String] = [:]
    @Published var loading = true

    let repo = PromoterRepo()
    let offerRepo = SupplierRepo()

    func load() async {
        loading = true
        async let a = repo.myAllocations()
        async let s = offerRepo.stats()
        async let c = offerRepo.clubs()
        allocations = (try? await a) ?? []
        stats = (try? await s) ?? .empty
        clubNames = Dictionary(uniqueKeysWithValues: ((try? await c) ?? []).map { ($0.id, $0.name) })
        loading = false
    }

    func clubName(_ id: UUID) -> String { clubNames[id] ?? "Venue" }

    // ── Private-night earnings (unchanged maths) ─────────────────────────────
    var thisMonthAllocations: [PromoterAllocation] {
        let prefix = Self.monthPrefix.string(from: Date())
        return allocations.filter { ($0.night?.nightDate ?? "").hasPrefix(prefix) }
    }
    var thisMonthEarnings: Decimal { thisMonthAllocations.reduce(Decimal(0)) { $0 + $1.earnings } }
    var nightsThisMonth: Int { thisMonthAllocations.count }
    var hasPayoutData: Bool { allocations.contains { $0.earnings > 0 } }

    var lastMonthEarnings: Decimal {
        let last = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
        let prefix = Self.monthPrefix.string(from: last)
        return allocations.filter { ($0.night?.nightDate ?? "").hasPrefix(prefix) }
            .reduce(Decimal(0)) { $0 + $1.earnings }
    }
    var earningsDeltaPercent: Int? {
        let prev = lastMonthEarnings
        guard prev > 0 else { return nil }
        return NSDecimalNumber(decimal: (thisMonthEarnings - prev) / prev * 100).intValue
    }

    // ── Combined headline (nights + offers) ──────────────────────────────────
    /// Guests this month across everything: names on private-night lists plus
    /// people who booked through public offers.
    var guestsThisMonth: Int {
        thisMonthAllocations.reduce(0) { $0 + $1.guestCount } + stats.overview.thisMonth.people
    }
    var arrivedThisMonth: Int {
        thisMonthAllocations.reduce(0) { $0 + $1.checkedInCount } + stats.overview.thisMonth.arrived
    }
    var checkInRate: Int? {
        guard guestsThisMonth > 0 else { return nil }
        return Int((Double(arrivedThisMonth) / Double(guestsThisMonth) * 100).rounded())
    }

    static let monthPrefix: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM"; return f }()
    static let dayPrefix: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
}

struct EarningsView: View {   // entry point kept; the tab is now "Stats"
    @StateObject private var model = StatisticsModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Stats.")
                    .font(.cfSerif(52))
                    .foregroundStyle(Theme.parchment)
                    .padding(.top, 4)

                if model.loading {
                    ProgressView().tint(Theme.parchment).frame(maxWidth: .infinity).padding(.top, 40)
                } else {
                    overviewCard
                    miniStatsRow
                    offersSection
                    earningsSection
                }
                Spacer(minLength: 80)
            }
            .padding(20)
        }
        .background(Theme.night)
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    // MARK: - Overview

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Kicker("Guests this month", color: Theme.parchmentDim)
            Text("\(model.guestsThisMonth)")
                .font(.cfSerif(56))
                .foregroundStyle(Theme.ember)
            HStack(spacing: 14) {
                Text("\(model.arrivedThisMonth) arrived")
                    .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                if let r = model.checkInRate {
                    HStack(spacing: 5) {
                        Image(systemName: "checkmark.circle").font(.system(size: 11))
                        Text("\(r)% CHECK-IN").font(.cfMono(10, weight: .medium)).kerning(1)
                    }
                    .foregroundStyle(Theme.gold)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))
    }

    private var miniStatsRow: some View {
        HStack(spacing: 12) {
            miniStat("Live offers", "\(model.stats.overview.liveOffers)")
            miniStat("Venues", "\(model.stats.overview.venues)")
            miniStat("Nights", "\(model.nightsThisMonth)")
        }
    }

    // MARK: - Public offers

    @ViewBuilder
    private var offersSection: some View {
        if !model.stats.byOffer.isEmpty {
            HStack {
                Kicker("Public offers", color: Theme.parchmentDim)
                Spacer()
                Text("\(model.stats.overview.allTime.people) booked all-time")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
            .padding(.top, 8)

            VStack(spacing: 10) {
                ForEach(model.stats.byOffer) { line in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(line.title)
                                .font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                                .lineLimit(1)
                            Text(model.clubName(line.clubId))
                                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        statPill("People", "\(line.people)")
                        statPill("Arrived", "\(line.arrived)")
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14).fill(Theme.nightLift))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
                }
            }
        }
    }

    // MARK: - Earnings (now a section)

    @ViewBuilder
    private var earningsSection: some View {
        Kicker("Earnings", color: Theme.parchmentDim).padding(.top, 12)

        if !model.hasPayoutData {
            Text("No payout-tracked nights yet. Turn on payout tracking when you create a private event to see your earnings here.")
                .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            VStack(alignment: .leading, spacing: 14) {
                Kicker("This month", color: Theme.parchmentDim)
                Text(format(model.thisMonthEarnings))
                    .font(.cfSerif(44)).foregroundStyle(Theme.ember)
                if let d = model.earningsDeltaPercent {
                    HStack(spacing: 6) {
                        Image(systemName: d >= 0 ? "arrow.up.right" : "arrow.down.right")
                            .font(.system(size: 11, weight: .bold))
                        Text("\(d >= 0 ? "+" : "")\(d)% FROM LAST MONTH")
                            .font(.cfMono(10, weight: .medium)).kerning(1)
                    }
                    .foregroundStyle(Theme.flame)
                }
                if model.nightsThisMonth > 0 {
                    Text("Avg \(format(model.thisMonthEarnings / Decimal(model.nightsThisMonth))) / night")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))

            VStack(spacing: 0) {
                ForEach(model.allocations.filter { $0.earnings > 0 }) { a in
                    payoutRow(a)
                    Divider().background(Theme.hairline)
                }
            }
        }
    }

    private func payoutRow(_ a: PromoterAllocation) -> some View {
        let paid = a.payoutStatus == "paid"
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(a.night?.club?.name ?? a.night?.displayTitle ?? "Night")
                    .font(.cfSerif(22)).foregroundStyle(Theme.parchment)
                Text("\(a.night?.nightDate ?? "") · \(a.usedLabel) guests")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text(format(a.earnings)).font(.cfSerif(24)).foregroundStyle(Theme.ember)
                Text(a.payoutStatus.uppercased())
                    .font(.cfMono(9, weight: .medium)).kerning(1.5)
                    .foregroundStyle(paid ? Theme.gold : Theme.parchmentDim)
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .overlay(Capsule().stroke(paid ? Theme.gold.opacity(0.6) : Theme.parchmentFaint))
            }
        }
        .padding(.vertical, 16)
    }

    // MARK: - Bits

    private func statPill(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.cfMono(8, weight: .medium)).kerning(1.2)
                .foregroundStyle(Theme.parchmentDim)
            Text(value).font(.cfMono(12, weight: .medium)).foregroundStyle(Theme.parchment)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.night))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.hairline))
    }

    private func miniStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            Text(value).font(.cfSerif(24)).foregroundStyle(Theme.parchment)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func format(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency; f.currencyCode = "EUR"; f.maximumFractionDigits = 0
        return f.string(from: d as NSDecimalNumber) ?? "€0"
    }
}
