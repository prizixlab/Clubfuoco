import SwiftUI

// Loading placeholder for the supplier tabs. The real title/subtitle show
// immediately; the venue cards below are redacted skeletons so we never flash
// an empty state ("Nothing tonight") before the data has arrived.
struct SupplierSkeleton: View {
    var title: String
    var subtitle: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.cfSerif(38)).foregroundStyle(Theme.parchment)
                    Text(subtitle).font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(.top, 8)

                VStack(spacing: 20) {
                    ForEach(0..<3, id: \.self) { _ in card }
                }
                .redacted(reason: .placeholder)

                Spacer(minLength: 60)
            }
            .padding(20)
        }
        .allowsHitTesting(false)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Placeholder Venue Name")
                .font(.cfSerif(22)).foregroundStyle(Theme.parchment)
            ForEach(0..<2, id: \.self) { _ in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Free Guestlist")
                            .font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                        Text("Free till 1:00 AM · details load here")
                            .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                    }
                    Spacer(minLength: 12)
                    Text("FREE").font(.cfMono(11, weight: .medium)).foregroundStyle(Theme.ember)
                }
                .padding(.vertical, 6)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.hairline))
    }
}
