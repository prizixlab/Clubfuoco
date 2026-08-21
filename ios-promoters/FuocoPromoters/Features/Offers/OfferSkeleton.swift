import SwiftUI

/// Redacted stand-in for the public-offers list while it loads.
///
/// Offers arrive after the rest of the Tonight screen, so without this the
/// section simply isn't there and then pops in — which reads as the app having
/// nothing for you, right up until it does.
///
/// Section-shaped, not screen-shaped: this used to be a whole-screen placeholder
/// with its own ScrollView and title, written for a supplier tab that no longer
/// exists. In its current home that would have nested a ScrollView inside a
/// ScrollView and printed a second heading.
struct OfferSkeleton: View {
    /// How many placeholder venues to draw. Two, because the common case is one
    /// or two clubs and a wall of five ghosts overstates what's coming.
    var venues: Int = 2

    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<venues, id: \.self) { _ in card }
        }
        .redacted(reason: .placeholder)
        // Nothing here is real, so nothing here should be tappable — or
        // readable aloud as if it were content.
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker("PLACEHOLDER VENUE", color: Theme.flame, size: 9)
            ForEach(0..<2, id: \.self) { _ in
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Theme.ember.opacity(0.15))
                        .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Free Guestlist")
                            .font(.cfSans(15, weight: .medium))
                            .foregroundStyle(Theme.parchment)
                        Text("Every Friday · details load here")
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.parchmentDim)
                    }
                    Spacer(minLength: 8)
                    Text("FREE")
                        .font(.cfMono(10, weight: .medium)).kerning(0.5)
                        .foregroundStyle(Theme.ember)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
