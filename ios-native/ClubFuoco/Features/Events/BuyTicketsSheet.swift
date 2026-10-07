import SwiftUI

/// Choosing how many tickets to buy for a paid night, and whose name is on each.
///
/// Every ticket is its own named row with its own QR and Wallet pass (see
/// migration 20261007_multi_ticket_purchases) — not plus-ones on the buyer's
/// QR — so friends can arrive separately. The buyer holds them in Tickets and
/// sends each one on from there.
///
/// Two uses:
///   • `.withMe`   — the first purchase. Ticket 1 is the buyer's own; any more
///                   ask for a name.
///   • `.forOthers` — "Buy another ticket" once the buyer already has theirs:
///                   every ticket is for someone else.
///
/// The sheet only collects names. The caller pays (SpotPayment) after the
/// sheet has gone, so the Apple Pay sheet never presents over a dismissing one.
struct BuyTicketsSheet: View {
    enum Mode { case withMe(buyerName: String), forOthers }

    let mode: Mode
    let eventTitle: String
    /// Unit price shown here. The server charges the live release's price
    /// whatever this says, and Apple Pay shows the server's total.
    let unitCents: Int
    /// Called with the names for the OTHER tickets (never the buyer's own).
    let onConfirm: ([String]) -> Void

    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var count = 1
    @State private var names: [String] = []
    @FocusState private var focused: Int?

    /// Mirrors MAX_TICKETS in src/lib/spot-sale.ts.
    private static let maxTickets = 10

    private var forOthers: Bool { if case .forOthers = mode { return true } else { return false } }
    /// Rows that need a typed name: all of them for others, all but "You" otherwise.
    private var nameCount: Int { forOthers ? count : count - 1 }
    private var trimmed: [String] {
        names.prefix(nameCount).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    }
    private var ready: Bool { nameCount == 0 || trimmed.allSatisfy { !$0.isEmpty } }

    private func money(_ cents: Int) -> String {
        cents % 100 == 0 ? "€\(cents / 100)" : String(format: "€%.2f", Double(cents) / 100)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(locale.t(forOthers ? "tickets.another" : "tickets.title"))
                    .font(.cfDisplay(24, weight: .bold))
                    .foregroundStyle(Explore.ink)
                    .padding(.top, 8)
                Text(eventTitle)
                    .font(.cfSans(14))
                    .foregroundStyle(Explore.ink2)
                    .padding(.top, 4)

                stepper.padding(.top, 22)

                VStack(spacing: 10) {
                    if case .withMe(let buyer) = mode {
                        row(label: String(format: locale.t("tickets.ticketN"), 1)) {
                            Text("\(buyer) · \(locale.t("tickets.you"))")
                                .font(.cfSans(15))
                                .foregroundStyle(Explore.ink2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    ForEach(0..<nameCount, id: \.self) { i in
                        row(label: String(format: locale.t("tickets.ticketN"), forOthers ? i + 1 : i + 2)) {
                            TextField(locale.t("tickets.theirName"), text: binding(i))
                                .font(.cfSans(15))
                                .foregroundStyle(Explore.ink)
                                .textContentType(.name)
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()
                                .submitLabel(i == nameCount - 1 ? .done : .next)
                                .focused($focused, equals: i)
                                .onSubmit { focused = i + 1 < nameCount ? i + 1 : nil }
                        }
                    }
                }
                .padding(.top, 18)

                if nameCount > 0 {
                    Text(locale.t("tickets.namesHint"))
                        .font(.cfSans(12.5))
                        .foregroundStyle(Explore.ink3)
                        .padding(.top, 12)
                }

                HStack {
                    Text(locale.t("tickets.total").uppercased())
                        .font(.cfMono(10)).kerning(1.3)
                        .foregroundStyle(Explore.ink3)
                    Spacer()
                    Text(money(unitCents * count))
                        .font(.cfSans(17, weight: .semibold))
                        .foregroundStyle(Explore.ink)
                }
                .padding(.top, 22)

                Button {
                    guard ready else { return }
                    Haptics.tap()
                    onConfirm(Array(trimmed))
                    dismiss()
                } label: {
                    Text(String(format: locale.t("tickets.pay"), money(unitCents * count)))
                        .font(.cfSans(15.5, weight: .semibold))
                        .foregroundStyle(Explore.onAccent)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(Explore.accent, in: .capsule)
                        .opacity(ready ? 1 : 0.45)
                }
                .disabled(!ready)
                .padding(.top, 14)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Explore.bg)
        .onAppear { if forOthers { focused = 0 } }
    }

    private var stepper: some View {
        HStack {
            Text(locale.t("tickets.howMany"))
                .font(.cfSans(15, weight: .medium))
                .foregroundStyle(Explore.ink)
            Spacer()
            stepButton("minus", enabled: count > 1) { count -= 1 }
            Text("\(count)")
                .font(.cfSans(17, weight: .semibold))
                .foregroundStyle(Explore.ink)
                .frame(minWidth: 34)
                .contentTransition(.numericText())
            stepButton("plus", enabled: count < Self.maxTickets) { count += 1 }
        }
    }

    private func stepButton(_ icon: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            withAnimation(.snappy) { action() }
        } label: {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(enabled ? Explore.ink : Explore.ink3)
                .frame(width: 38, height: 38)
                .overlay(Circle().stroke(Explore.lineStrong, lineWidth: 1))
        }
        .disabled(!enabled)
    }

    private func row<C: View>(label: String, @ViewBuilder content: () -> C) -> some View {
        HStack(spacing: 12) {
            Text(label.uppercased())
                .font(.cfMono(9)).kerning(1.2)
                .foregroundStyle(Explore.ink3)
                .frame(width: 66, alignment: .leading)
            content()
        }
        .padding(.horizontal, 14)
        .frame(height: 50)
        .background(Explore.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Explore.line, lineWidth: 1))
    }

    /// Names survive the stepper going down and back up.
    private func binding(_ i: Int) -> Binding<String> {
        Binding(
            get: { i < names.count ? names[i] : "" },
            set: { value in
                while names.count <= i { names.append("") }
                names[i] = value
            })
    }
}
