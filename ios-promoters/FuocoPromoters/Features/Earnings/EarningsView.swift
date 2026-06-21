import SwiftUI

@MainActor
final class EarningsModel: ObservableObject {
    @Published var allocations: [PromoterAllocation] = []
    @Published var loading = true
    let repo = PromoterRepo()

    func load() async {
        loading = true
        allocations = (try? await repo.myAllocations()) ?? []
        loading = false
    }

    var thisMonthAllocations: [PromoterAllocation] {
        let prefix = Self.monthPrefix.string(from: Date())
        return allocations.filter { ($0.night?.nightDate ?? "").hasPrefix(prefix) }
    }
    var thisMonthTotal: Decimal {
        thisMonthAllocations.reduce(Decimal(0)) { $0 + $1.earnings }
    }
    var nightsCount: Int { thisMonthAllocations.count }
    var allTimeTotal: Decimal {
        allocations.reduce(Decimal(0)) { $0 + $1.earnings }
    }

    static let monthPrefix: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"; return f
    }()
}

struct EarningsView: View {
    @StateObject private var model = EarningsModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Earnings.")
                    .font(.cfSerif(48))
                    .foregroundStyle(Theme.parchment)

                VStack(alignment: .leading, spacing: 6) {
                    Kicker("This month")
                    Text(format(model.thisMonthTotal))
                        .font(.cfSerif(40))
                        .foregroundStyle(Theme.ember)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
                .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))

                HStack(spacing: 16) {
                    miniStat("Total Nights", "\(model.nightsCount)")
                    miniStat("Avg / Night", model.nightsCount == 0 ? "€0"
                             : format(model.thisMonthTotal / Decimal(model.nightsCount)))
                }

                Kicker("Recent activity").padding(.top, 8)

                if model.loading {
                    ProgressView().tint(Theme.parchment).frame(maxWidth: .infinity)
                } else if model.allocations.isEmpty {
                    Text("Nothing yet.")
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.parchmentDim)
                } else {
                    VStack(spacing: 0) {
                        ForEach(model.allocations) { a in
                            row(a)
                            Divider().background(Theme.hairline)
                        }
                    }
                }
                Spacer(minLength: 80)
            }
            .padding(20)
        }
        .background(Theme.night)
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    private func row(_ a: PromoterAllocation) -> some View {
        let total = a.earnings
        return HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(a.night?.club?.name ?? a.night?.displayTitle ?? "Night")
                    .font(.cfSerif(18)).foregroundStyle(Theme.parchment)
                Text("\(a.guestCount) / \(a.spots) guests")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(format(total))
                    .font(.cfSerif(20)).foregroundStyle(Theme.flame)
                Capsule()
                    .fill(a.payoutStatus == "paid" ? Theme.gold.opacity(0.25) : Theme.parchment.opacity(0.08))
                    .frame(width: 70, height: 22)
                    .overlay(Text(a.payoutStatus.uppercased())
                        .font(.cfMono(9, weight: .medium))
                        .kerning(1.5)
                        .foregroundStyle(a.payoutStatus == "paid" ? Theme.gold : Theme.parchmentDim))
            }
        }
        .padding(.vertical, 14)
    }

    private func miniStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            Text(value).font(.cfSerif(20)).foregroundStyle(Theme.parchment)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func format(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "EUR"
        f.maximumFractionDigits = 0
        return f.string(from: d as NSDecimalNumber) ?? "€0"
    }
}
