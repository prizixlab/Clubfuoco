import SwiftUI
import Observation

/// The user's hearted (saved) clubs — reached from the Saved row on the You
/// page. Loads place_favorites and the matching club rows, then lists them with
/// a tap-through to the venue detail.
struct SavedClubsView: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var model = SavedClubsModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(locale.t("explore.savedTitle"))
                        .font(.cfSerif(40, italic: true))
                        .foregroundStyle(Theme.ink)
                    Text(subtitle)
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.fadedSand)
                }
                .padding(.init(top: 4, leading: 20, bottom: 20, trailing: 20))

                switch model.state {
                case .loading:
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 48)
                case .loaded where model.places.isEmpty:
                    emptyState
                case .loaded:
                    VStack(spacing: 16) {
                        ForEach(model.places) { place in
                            NavigationLink {
                                ClubDetailView(place: place)
                            } label: {
                                savedCard(place)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }
            }
        }
        .background(Theme.cream)
        .navigationTitle(locale.t("profile.savedClubs"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(queries: auth.queries) }
    }

    private var subtitle: String {
        switch model.places.count {
        case 0:  return locale.t("explore.noSaved")
        case 1:  return locale.t("explore.savedOne")
        default: return String(format: locale.t("explore.savedMany"), model.places.count)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "heart")
                .font(.system(size: 42))
                .foregroundStyle(Theme.fadedSand.opacity(0.3))
                .padding(.bottom, 8)
            Text(locale.t("explore.nothingSaved"))
                .font(.cfSans(14))
                .foregroundStyle(Theme.fadedSand)
            Text(locale.t("explore.savedHint"))
                .font(.cfSans(12))
                .foregroundStyle(Theme.fadedSand.opacity(0.7))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 40)
        .padding(.vertical, 48)
    }

    private func savedCard(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Theme.imagePlaceholder
                .overlay {
                    if let url = place.coverPhoto.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Theme.imagePlaceholder }
                    } else {
                        Image(systemName: "music.note.house")
                            .font(.system(size: 30))
                            .foregroundStyle(Theme.fadedSand.opacity(0.4))
                    }
                }
                .frame(height: 160)
                .clipped()

            VStack(alignment: .leading, spacing: 6) {
                Text(place.name)
                    .font(.cfSerif(26))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(place.neighborhood ?? place.address)
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text(locale.t("explore.viewClub"))
                        .font(.cfSans(13, weight: .semibold))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(Theme.cream)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Theme.ink, in: .rect(cornerRadius: 12))
                .padding(.top, 8)
            }
            .padding(.init(top: 16, leading: 18, bottom: 18, trailing: 18))
        }
        .background(Theme.surface)
        .clipShape(.rect(cornerRadius: 16))
        .shadow(color: Color(hex: 0x221E1A).opacity(0.08), radius: 12, y: 6)
    }
}

@MainActor
@Observable
final class SavedClubsModel {
    enum LoadState { case loading, loaded }

    private(set) var state: LoadState = .loading
    private(set) var places: [Place] = []

    func load(queries: Queries) async {
        let ids = (try? await queries.placeFavoriteIds()) ?? []
        places = (try? await queries.clubsByIds(Array(ids))) ?? []
        state = .loaded
    }
}
