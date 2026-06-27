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

    var lastMonthTotal: Decimal {
        let last = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
        let prefix = Self.monthPrefix.string(from: last)
        return allocations.filter { ($0.night?.nightDate ?? "").hasPrefix(prefix) }
            .reduce(Decimal(0)) { $0 + $1.earnings }
    }

    /// Month-over-month % change, nil when there's no prior-month baseline.
    var deltaPercent: Int? {
        let prev = lastMonthTotal
        guard prev > 0 else { return nil }
        let change = (thisMonthTotal - prev) / prev * 100
        return NSDecimalNumber(decimal: change).intValue
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
                    .font(.cfSerif(52))
                    .foregroundStyle(Theme.parchment)
                    .padding(.top, 4)

                VStack(alignment: .leading, spacing: 14) {
                    Kicker("This month", color: Theme.parchmentDim)
                    Text(format(model.thisMonthTotal))
                        .font(.cfSerif(56))
                        .foregroundStyle(Theme.ember)
                    if let d = model.deltaPercent {
                        HStack(spacing: 6) {
                            Image(systemName: d >= 0 ? "arrow.up.right" : "arrow.down.right")
                                .font(.system(size: 11, weight: .bold))
                            Text("\(d >= 0 ? "+" : "")\(d)% FROM LAST MONTH")
                                .font(.cfMono(10, weight: .medium)).kerning(1)
                        }
                        .foregroundStyle(Theme.flame)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(22)
                .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))

                HStack(spacing: 16) {
                    miniStat("Total Nights", "\(model.nightsCount)")
                    miniStat("Avg / Night", model.nightsCount == 0 ? "€0"
                             : format(model.thisMonthTotal / Decimal(model.nightsCount)))
                }

                HStack {
                    Kicker("Recent activity", color: Theme.parchmentDim)
                    Spacer()
                    Text("VIEW ALL").font(.cfMono(10, weight: .medium)).kerning(1.5)
                        .foregroundStyle(Theme.ember)
                }
                .padding(.top, 8)

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
        let paid = a.payoutStatus == "paid"
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(a.night?.club?.name ?? a.night?.displayTitle ?? "Night")
                    .font(.cfSerif(24)).foregroundStyle(Theme.parchment)
                Text("\(a.usedLabel) guests")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text(format(total))
                    .font(.cfSerif(26)).foregroundStyle(Theme.ember)
                Text(a.payoutStatus.uppercased())
                    .font(.cfMono(9, weight: .medium)).kerning(1.5)
                    .foregroundStyle(paid ? Theme.gold : Theme.parchmentDim)
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .overlay(Capsule().stroke(paid ? Theme.gold.opacity(0.6) : Theme.parchmentFaint))
            }
        }
        .padding(.vertical, 18)
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
