import SwiftUI

@MainActor
final class TonightModel: ObservableObject {
    @Published var allocations: [PromoterAllocation] = []
    @Published var series: [PromoterSeries] = []
    @Published var loading = true
    @Published var error: String?

    let repo = PromoterRepo()

    func load() async {
        loading = true; error = nil
        do {
            async let a = repo.myAllocations()
            async let s = repo.mySeries()
            allocations = try await a
            series = (try? await s) ?? []
        } catch {
            self.error = "Couldn't load your nights."
        }
        loading = false
    }

    var todays: PromoterAllocation? {
        let today = Self.dateFormatter.string(from: Date())
        return allocations.first { $0.night?.nightDate == today }
    }

    var upcoming: [PromoterAllocation] {
        let today = Self.dateFormatter.string(from: Date())
        return allocations.filter { ($0.night?.nightDate ?? "") > today }
    }

    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

struct TonightView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model = TonightModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header

                if model.loading {
                    ProgressView().tint(Theme.parchment).padding(.top, 40)
                } else if let err = model.error {
                    Text(err).font(.cfSans(14)).foregroundStyle(Theme.wine)
                } else {
                    if let tonight = model.todays {
                        featured(tonight)
                    } else {
                        emptyTonight
                    }

                    if !model.upcoming.isEmpty {
                        Kicker("Upcoming this week").padding(.top, 8)
                        VStack(spacing: 0) {
                            ForEach(model.upcoming) { a in
                                NavigationLink(value: a) { upcomingRow(a) }
                                    .buttonStyle(.plain)
                                Divider().background(Theme.hairline)
                            }
                        }
                    }
                }

                Spacer(minLength: 80)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
        }
        .background(Theme.night)
        .task {
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                await model.load()
            }
        }
        .refreshable { await model.load() }
        .navigationDestination(for: PromoterAllocation.self) { a in
            GuestlistView(allocation: a)
        }
    }

    private var header: some View {
        HStack {
            if case .signedIn(let p) = auth.state {
                Text("Hola, \(p.displayName)")
                    .font(.cfSerif(22))
                    .foregroundStyle(Theme.parchment)
            }
            Spacer()
            Image(systemName: "bell")
                .foregroundStyle(Theme.flame)
                .font(.system(size: 18))
        }
    }

    private var emptyTonight: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Tonight")
                .font(.cfSerif(48))
                .foregroundStyle(Theme.parchment)
            Text("No night assigned to you tonight.")
                .font(.cfSans(15))
                .foregroundStyle(Theme.parchmentDim)
        }
    }

    private func featured(_ a: PromoterAllocation) -> some View {
        let n = a.night
        return VStack(alignment: .leading, spacing: 16) {
            Text("Tonight")
                .font(.cfSerif(48))
                .foregroundStyle(Theme.parchment)
            Text(formattedDate(n?.nightDate))
                .font(.cfSerif(18, italic: true))
                .foregroundStyle(Theme.parchmentDim)

            NavigationLink(value: a) {
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: Theme.radiusCard)
                        .fill(LinearGradient(
                            colors: [Theme.nightLift, Theme.ember.opacity(0.35)],
                            startPoint: .top, endPoint: .bottom))
                        .frame(height: 220)
                    VStack(alignment: .leading, spacing: 8) {
                        Kicker("Currently featured")
                        HStack(alignment: .lastTextBaseline) {
                            Text(n?.displayTitle ?? "Tonight")
                                .font(.cfSerif(34))
                                .foregroundStyle(Theme.parchment)
                            Spacer()
                            Capsule().fill(Theme.ember)
                                .frame(width: 120, height: 32)
                                .overlay(
                                    Text("\(a.usedLabel) used")
                                        .font(.cfMono(11, weight: .medium))
                                        .foregroundStyle(Theme.emberCream))
                        }
                    }.padding(16)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func upcomingRow(_ a: PromoterAllocation) -> some View {
        HStack(spacing: 14) {
            Text(shortDate(a.night?.nightDate))
                .font(.cfMono(11, weight: .medium))
                .foregroundStyle(Theme.flame)
                .frame(width: 56, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(a.night?.displayTitle ?? "Night")
                    .font(.cfSerif(20))
                    .foregroundStyle(Theme.parchment)
                Text(a.night?.club?.name ?? "—")
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.parchmentDim)
            }
            Spacer()
            Text(a.usedLabel)
                .font(.cfMono(10))
                .kerning(1.5)
                .foregroundStyle(Theme.flame)
        }
        .padding(.vertical, 16)
    }

    private func shortDate(_ s: String?) -> String {
        guard let s, let d = Self.iso.date(from: s) else { return "" }
        let f = DateFormatter(); f.dateFormat = "EEE d"
        return f.string(from: d).uppercased()
    }

    private func formattedDate(_ s: String?) -> String {
        guard let s, let d = Self.iso.date(from: s) else { return "" }
        let f = DateFormatter(); f.dateFormat = "EEEE, MMMM d"
        return f.string(from: d)
    }

    static let iso: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
}
