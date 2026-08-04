import SwiftUI

/// Status chip for the promoter's own nights and series — Pending review /
/// Rejected / Live, keyed on review_status. Mirrors the supplier pending-card
/// language in OffersHomeView. Render only when a ReviewState is known
/// (the column is drift-defensive and may be absent).
struct ReviewBadge: View {
    let state: ReviewState

    var body: some View {
        Text(state.label)
            .font(.cfMono(9, weight: .medium)).kerning(1.2)
            .foregroundStyle(foreground)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(background))
            .overlay(Capsule().stroke(border))
    }

    private var foreground: Color {
        switch state {
        case .pending:  return Theme.ember
        case .rejected: return Theme.parchment
        case .live:     return Theme.gold
        }
    }
    private var background: Color {
        switch state {
        case .pending:  return Theme.ember.opacity(0.12)
        case .rejected: return Theme.wine.opacity(0.55)
        case .live:     return .clear
        }
    }
    private var border: Color {
        switch state {
        case .pending:  return Theme.ember.opacity(0.4)
        case .rejected: return Theme.wine
        case .live:     return Theme.gold.opacity(0.6)
        }
    }
}

/// Inline card explaining a rejection to the promoter, with the reviewer's
/// reason when one was captured.
struct RejectionNotice: View {
    let reason: String?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "xmark.octagon")
                .font(.system(size: 15))
                .foregroundStyle(Theme.wine)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text("Not approved")
                    .font(.cfSans(13, weight: .medium))
                    .foregroundStyle(Theme.parchment)
                Text(reasonText)
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.parchmentDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.wine.opacity(0.12)))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.wine.opacity(0.4)))
    }

    private var reasonText: String {
        if let reason, !reason.isEmpty { return reason }
        return "Club Fuoco didn't approve this. Edit it and resubmit, or contact us for details."
    }
}
