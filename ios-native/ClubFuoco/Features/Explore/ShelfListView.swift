import SwiftUI

/// Full vertical list of one explore shelf's venues — pushed when the user
/// taps the "N venues →" button in a shelf header. Rows tap through to the
/// venue detail via the stack's `navigationDestination(for: Place.self)`.
struct ShelfListView: View {
    let shelf: Shelf
    let model: ExploreViewModel
    let onSave: (Place) -> Void
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @Environment(\.pushPlace) private var pushPlace

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(shelf.subtitle.uppercased())
                        .font(.cfSans(9))
                        .kerning(1.3)
                        .foregroundStyle(Theme.fadedSand)
                    Text(shelf.title)
                        .font(.cfSerif(38, italic: true))
                        .foregroundStyle(Theme.ink)
                    Text(String(format: locale.t("explore.shelfCount"), shelf.places.count))
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.fadedSand)
                }
                .padding(.init(top: 6, leading: 20, bottom: 22, trailing: 20))

                VStack(spacing: 16) {
                    ForEach(shelf.places) { place in
                        // Frame-scoped tap for navigation (see PushPlaceKey), with
                        // the save button as a sibling overlay that owns its own
                        // region — so tapping the bookmark saves, and a miss can
                        // only ever open this row, never a neighbour.
                        row(place)
                            .contentShape(.rect)
                            .onTapGesture { pushPlace(place) }
                            .overlay(alignment: .topTrailing) {
                                saveButton(place)
                            }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
        }
        .background(Theme.cream)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                backButton
                Spacer()
            }
            .padding(.bottom, 6)
            .background(Theme.cream)
        }
    }

    private var backButton: some View {
        Button {
            Haptics.tap()
            dismiss()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 38, height: 38)
                .background(Theme.surface, in: .circle)
                .overlay(Circle().stroke(Theme.hairline))
                .shadow(color: Color(hex: 0x221E1A).opacity(0.06), radius: 6, y: 3)
        }
        .padding(.leading, 16)
        .padding(.top, 4)
    }

    private func row(_ place: Place) -> some View {
        // Full-bleed photo card in the app's "cinema" idiom — name in white
        // serif over a bottom scrim, distance/OPEN badges up top, bookmark on
        // the photo. Replaces the original thumbnail rows, which truncated
        // names and read like a settings list.
        ZStack(alignment: .bottomLeading) {
            Theme.imagePlaceholder
                .overlay {
                    if let url = place.coverPhoto.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Theme.imagePlaceholder }
                    }
                }
                .frame(height: 190)
                .clipped()

            // Scrim: darken top (badges) + bottom (name) so text always reads.
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.38), location: 0),
                    .init(color: .clear, location: 0.32),
                    .init(color: .clear, location: 0.5),
                    .init(color: .black.opacity(0.72), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )

            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(place.name)
                        .font(.cfSerif(24, italic: true))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(place.neighborhood ?? place.address)
                        .font(.cfSans(12))
                        .foregroundStyle(.white.opacity(0.75))
                        .lineLimit(1)
                }
                Spacer(minLength: 10)
                if let rating = RumbaScore.score(clubId: place.placeId, realRating: place.rating).value {
                    HStack(spacing: 3) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.starGold)
                        Text(String(format: "%.1f", rating))
                            .font(.cfSans(12, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
            }
            .padding(14)
        }
        .frame(height: 190)
        .clipShape(.rect(cornerRadius: 18))
        .overlay(alignment: .topLeading) {
            HStack(spacing: 6) {
                if let distance = place.distance {
                    Text(ExploreViewModel.formatDistance(distance).uppercased())
                        .font(.cfSans(9, weight: .medium))
                        .kerning(1)
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.45), in: .capsule)
                }
                if place.isOpen == true {
                    Text(locale.t("explore.open").uppercased())
                        .font(.cfSans(9, weight: .semibold))
                        .kerning(1)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.success, in: .capsule)
                }
            }
            .padding(12)
        }
        .shadow(color: Color(hex: 0x221E1A).opacity(0.10), radius: 10, y: 6)
    }

    private func saveButton(_ place: Place) -> some View {
        Button {
            onSave(place)
        } label: {
            let isSaved = model.saved.contains(place.placeId)
            Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                .font(.system(size: 14))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(.black.opacity(0.45), in: .circle)
        }
        .buttonStyle(.plain)
        .padding(10)
    }
}
