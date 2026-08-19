import SwiftUI

/// Events the guest saved but hasn't paid for, pinned above their real tickets.
///
/// These are NOT tickets and the section works hard not to look like one: no
/// QR, no Wallet button, a dashed edge instead of a solid card, and the price
/// stated as an action rather than a fact. A guest who mistakes a bookmark for
/// entry finds out at a door, which is the worst possible place.
struct SavedEventsSection: View {
    @Environment(\.api) private var api
    @State private var events: [SavedEvent] = []
    @State private var loading = true

    /// Opens the invite so they can pay.
    var onOpen: (String) -> Void

    var body: some View {
        Group {
            if !events.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("SAVED — NOT PAID YET")
                        .font(.cfMono(10)).kerning(2)
                        .foregroundStyle(Theme.gold)

                    ForEach(events) { e in
                        Button { onOpen(e.inviteToken) } label: { row(e) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        .task { await load() }
        // A save made on the invite sheet should show up here without a relaunch.
        .onReceive(NotificationCenter.default.publisher(for: .cfInviteClaimed)) { _ in
            Task { await load() }
        }
    }

    private func row(_ e: SavedEvent) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(e.title ?? e.venueName)
                    .font(.cfSans(15, weight: .medium))
                    .foregroundStyle(Theme.parchment)
                    .lineLimit(1)
                Text("\(e.venueName) · \(SavedEvent.formatDate(e.nightDate))")
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.parchment.opacity(0.6))
            }
            Spacer(minLength: 8)
            // The price reads as the thing left to do, not as a label.
            Text(e.priceCents > 0 ? "Pay \(e.priceLabel)" : "Join")
                .font(.cfSans(13, weight: .semibold))
                .foregroundStyle(Theme.emberCream)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Theme.ember))
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                .foregroundStyle(Theme.gold.opacity(0.35))
        )
        .contentShape(Rectangle())
    }

    private func load() async {
        defer { loading = false }
        struct Resp: Decodable, Sendable { let events: [SavedEvent] }
        // Signed out is the common case here, not an error — stay silent.
        guard let resp: Resp = try? await api.get("/api/me/saved-events") else {
            events = []
            return
        }
        events = resp.events
    }
}

struct SavedEvent: Decodable, Identifiable, Sendable {
    let allocationId: String
    let inviteToken: String
    let title: String?
    let nightDate: String
    let venueName: String
    let priceCents: Int
    let currency: String?

    var id: String { allocationId }

    var priceLabel: String {
        let symbol = (currency ?? "eur").lowercased() == "eur" ? "€" : ""
        return priceCents % 100 == 0
            ? "\(symbol)\(priceCents / 100)"
            : String(format: "%@%.2f", symbol, Double(priceCents) / 100)
    }

    static func formatDate(_ iso: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.dateFormat = "EEE d MMM"
        return out.string(from: d)
    }
}
