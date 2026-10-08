import SwiftUI

/// Selling VIP tables. The products are the club's saved Fourvenues tables;
/// Club Fuoco ranks which promoters sell each one, and being ranked is all it
/// takes — you sell every night the table is on sale. Stepping back here (a
/// night, a club, or VIP altogether) hands your tables to the next promoter
/// straight away; stepping back in takes them back if you rank above them.
struct VipView: View {
    @State private var vip: VipSetup?
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    private let repo = OfferRepo()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("VIP tables")
                    .font(.cfSerif(34, italic: true))
                    .foregroundStyle(Theme.parchment)
                Text("You sell the club’s own tables at their own prices. Club Fuoco decides the order promoters get each table. Suspend a night, pause a venue or switch VIP off, and the next promoter takes your tables for that time.")
                    .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)

                if let error {
                    Text(error).font(.cfSans(13)).foregroundStyle(Theme.ember)
                }
                if loading && vip == nil {
                    ProgressView().tint(Theme.gold).frame(maxWidth: .infinity)
                } else if let vip {
                    content(vip)
                } else {
                    Text("Publish an offer first to get your promoter brand. VIP is set up by Club Fuoco after that.")
                        .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                }
            }
            .padding(20)
        }
        .background(Theme.night.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder private func content(_ v: VipSetup) -> some View {
        // On / off
        card {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(v.vipPaused ? "VIP is off" : "Selling VIP")
                        .font(.cfSans(16, weight: .semibold))
                        .foregroundStyle(v.vipPaused ? Theme.ember : Theme.parchment)
                    Text(v.checkout == "fourvenues"
                         ? "Guests check out on Fourvenues through your link when it lists the table, otherwise through Club Fuoco."
                         : "Guests pay with Apple Pay through Club Fuoco.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
                Spacer()
                Toggle("", isOn: Binding(get: { !v.vipPaused }, set: { on in
                    Task { await save(["vip_paused": !on]) }
                }))
                .labelsHidden().tint(Theme.gold).disabled(saving)
            }
        }

        // What the guest pays now (Fuoco checkout)
        do {
            VStack(alignment: .leading, spacing: 8) {
                label("What the guest pays now")
                HStack(spacing: 8) {
                    payChip("Their choice", "both", v)
                    payChip("Deposit", "deposit", v)
                    payChip("Full price", "full", v)
                }
                Text("If a table has no deposit, the guest pays the full price.")
                    .font(.cfSans(11)).foregroundStyle(Theme.parchmentFaint)
            }
        }

        // Venues and nights
        VStack(alignment: .leading, spacing: 10) {
            label("Clubs you sell at")
            if v.venues.isEmpty {
                Text("Club Fuoco hasn’t given you any tables yet.")
                    .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
            }
            ForEach(v.venues) { venue in venueCard(venue, vip: v) }
        }
    }

    private func venueCard(_ venue: VipSetup.Venue, vip v: VipSetup) -> some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(venue.clubName).font(.cfSans(16, weight: .semibold)).foregroundStyle(Theme.parchment)
                        if let n = venue.rankedTables {
                            Text("\(n) table\(n == 1 ? "" : "s")").font(.cfMono(11)).foregroundStyle(Theme.parchmentDim)
                        }
                    }
                    Spacer()
                    Button(venue.paused ? "Resume" : "Pause") {
                        Task { await save(["venues": [["club_id": venue.clubId, "paused": !venue.paused]]]) }
                    }
                    .font(.cfSans(13, weight: .medium))
                    .foregroundStyle(venue.paused ? Theme.gold : Theme.parchmentDim)
                    .disabled(saving)
                }
                if venue.paused {
                    Text("Paused. You aren’t selling here until you resume.")
                        .font(.cfSans(12)).foregroundStyle(Theme.ember)
                } else {
                    Text((venue.nights ?? []).isEmpty ? "No nights on sale right now" : "Tap a night to suspend it")
                        .font(.cfSans(11)).foregroundStyle(Theme.parchmentFaint)
                    nightGrid(venue)
                }
            }
        }
        .opacity(v.vipPaused ? 0.5 : 1)
    }

    /// The nights your tables here are on sale, each a suspend toggle.
    private func nightGrid(_ venue: VipSetup.Venue) -> some View {
        let nights = venue.nights ?? []
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
            ForEach(nights, id: \.self) { night in
                let off = venue.skippedDates.contains(night)
                Button {
                    var next = Set(venue.skippedDates)
                    if off { next.remove(night) } else { next.insert(night) }
                    Task { await save(["venues": [["club_id": venue.clubId, "skipped_dates": Array(next).sorted()]]]) }
                } label: {
                    VStack(spacing: 2) {
                        Text(Self.weekday(night)).font(.cfMono(10))
                        Text(Self.dayMonth(night)).font(.cfSans(13, weight: .semibold))
                        Text(off ? "Off" : "On").font(.cfMono(9))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .foregroundStyle(off ? Theme.ember : Theme.parchment)
                    .background(off ? Theme.ember.opacity(0.12) : Theme.nightLift,
                                in: .rect(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(off ? Theme.ember.opacity(0.5) : Theme.hairline))
                }
                .buttonStyle(.plain)
                .disabled(saving)
            }
        }
    }

    private func payChip(_ title: String, _ value: String, _ v: VipSetup) -> some View {
        let on = v.vipPayment == value
        return Button {
            guard !on else { return }
            Task { await save(["vip_payment": value]) }
        } label: {
            Text(title).font(.cfSans(13, weight: .medium))
                .frame(maxWidth: .infinity).frame(height: 38)
                .foregroundStyle(on ? Theme.night : Theme.parchment)
                .background(on ? Theme.gold : Theme.nightLift, in: .capsule)
        }
        .buttonStyle(.plain).disabled(saving)
    }

    private func card<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        c().padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.nightLift, in: .rect(cornerRadius: Theme.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(Theme.hairline))
    }

    private func label(_ t: String) -> some View {
        Text(t.uppercased()).font(.cfMono(10)).kerning(2).foregroundStyle(Theme.gold)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do { vip = try await repo.vip(); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func save(_ body: [String: Any]) async {
        saving = true
        defer { saving = false }
        do { vip = try await repo.updateVip(body); error = nil }
        catch { self.error = error.localizedDescription }
    }

    // ── Dates (Madrid nights) ─────────────────────────────────────────────

    private static let madrid = TimeZone(identifier: "Europe/Madrid")!
    private static func formatter(_ f: String) -> DateFormatter {
        let d = DateFormatter(); d.locale = Locale(identifier: "en_GB"); d.timeZone = madrid; d.dateFormat = f; return d
    }
    private static let iso = formatter("yyyy-MM-dd")
    private static func weekday(_ n: String) -> String { iso.date(from: n).map { formatter("EEE").string(from: $0) } ?? "" }
    private static func dayMonth(_ n: String) -> String { iso.date(from: n).map { formatter("d MMM").string(from: $0) } ?? n }
}
