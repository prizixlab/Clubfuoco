import SwiftUI

/// Horizontal strip of the user's group nights at the top of the Tickets
/// screen — native port of GroupsStrip in bookings/page.tsx. Cards push the
/// group detail.
struct GroupsStrip: View {
    let groups: [GroupListItem]
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        if !groups.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Kicker(locale.t("groups.strip"), color: Theme.fadedSand)
                    .padding(.horizontal, 20)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(groups) { group in
                            NavigationLink(value: group) {
                                card(group)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
    }

    private func card(_ group: GroupListItem) -> some View {
        HStack(spacing: 10) {
            Color(hex: 0xEFE9DD)
                .overlay {
                    if let url = group.club?.coverImageUrl.flatMap(URL.init(string:)) {
                        AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0xEFE9DD) }
                    }
                }
                .frame(width: 44, height: 44)
                .clipShape(.rect(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 2) {
                Text(group.club?.name ?? "—")
                    .font(.cfSerif(16))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(shortDate(group.bookingDate))
                    .font(.cfSans(11))
                    .foregroundStyle(Theme.fadedSand)
            }

            if group.myRsvp == "invited" && group.status == "open" {
                Circle().fill(Theme.wine).frame(width: 8, height: 8)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.white, in: .rect(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(group.myRsvp == "invited" && group.status == "open" ? Theme.wine.opacity(0.35) : Theme.hairline)
        )
    }

    private func shortDate(_ value: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.locale == "es" ? "es_ES" : "en_GB")
        formatter.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return formatter.string(from: date)
    }
}
