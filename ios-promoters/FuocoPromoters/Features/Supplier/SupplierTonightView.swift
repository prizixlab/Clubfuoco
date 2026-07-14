import SwiftUI

// The supplier's "Tonight" tab: the venues where their guestlist is live
// tonight, each with the offers valid for tonight. A read-focused, live view —
// editing lives on the Guestlist tab. "Valid tonight" is derived from each
// offer's valid_days (handles "Every night", comma lists, and ranges like
// "Thu – Sun").
struct SupplierTonightView: View {
    @StateObject private var model = SupplierHomeModel()

    // 0 = Sunday … 6 = Saturday (matches `order` below).
    private var todayIndex: Int { Calendar.current.component(.weekday, from: Date()) - 1 }

    private var tonightByClub: [(club: UUID, offers: [SupplierOffer])] {
        model.byClub.compactMap { group in
            let tonight = group.offers.filter { $0.isActive && Self.nights($0.validDays).contains(todayIndex) }
            return tonight.isEmpty ? nil : (club: group.club, offers: tonight)
        }
    }

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            if model.loading {
                SupplierSkeleton(title: weekdayName, subtitle: "Venues running your guestlist tonight")
            } else {
                content
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(weekdayName).font(.cfSerif(38)).foregroundStyle(Theme.parchment)
                    Text("Venues running your guestlist tonight")
                        .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(.top, 8)

                if let error = model.error {
                    Text(error).font(.cfSans(13)).foregroundStyle(Theme.flame)
                }

                if tonightByClub.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Nothing running tonight")
                            .font(.cfSerif(22)).foregroundStyle(Theme.parchment)
                        Text("None of your offers are valid for \(weekdayName). See the Guestlist tab for your full list, or add offers there.")
                            .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 24)
                }

                ForEach(tonightByClub, id: \.club) { group in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 8) {
                            Image(systemName: "building.2.fill")
                                .font(.system(size: 13)).foregroundStyle(Theme.ember)
                            Text(model.clubName(group.club))
                                .font(.cfSerif(22)).foregroundStyle(Theme.parchment)
                        }
                        ForEach(group.offers) { offer in
                            TonightOfferRow(offer: offer)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Theme.nightLift))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.hairline))
                }

                Spacer(minLength: 60)
            }
            .padding(20)
        }
        .refreshable { await model.load() }
    }

    private var weekdayName: String {
        let f = DateFormatter(); f.dateFormat = "EEEE"; return f.string(from: Date())
    }

    /// The set of weekday indices (0=Sun…6=Sat) an offer's valid_days covers.
    /// Handles "Every night"/"Any night", comma lists ("Mon, Tue, Sun"), and
    /// ranges ("Thu – Sun", wrapping past Saturday).
    static func nights(_ validDays: String) -> Set<Int> {
        let v = validDays.lowercased()
        if v.contains("every") || v.contains("any") || v.contains("daily") { return Set(0...6) }
        let order = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
        func idx(_ s: String) -> Int? { order.firstIndex { s.contains($0) } }

        var result = Set<Int>()
        for part in v.split(separator: ",") {
            let seg = String(part)
            let sep = ["–", "—", "-"].first { seg.contains($0) }
            if let sep {
                let ends = seg.components(separatedBy: sep)
                if ends.count == 2, let a = idx(ends[0]), let b = idx(ends[1]) {
                    var i = a
                    while true { result.insert(i); if i == b { break }; i = (i + 1) % 7 }
                    continue
                }
            }
            if let d = idx(seg) { result.insert(d) }
        }
        return result
    }
}

private struct TonightOfferRow: View {
    let offer: SupplierOffer
    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(offer.title)
                    .font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                Text(offer.subtitle)
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                    .lineLimit(2)
            }
            Spacer(minLength: 12)
            Text(offer.isVip ? "€\(Int(offer.priceEur ?? 0))" : "FREE")
                .font(.cfMono(11, weight: .medium)).kerning(0.5)
                .foregroundStyle(offer.isVip ? Theme.flame : Theme.ember)
        }
        .padding(.vertical, 6)
    }
}
