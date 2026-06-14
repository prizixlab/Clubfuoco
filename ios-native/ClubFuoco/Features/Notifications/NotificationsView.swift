import SwiftUI
import Observation

/// Native port of the notifications page — list with type icons and
/// relative timestamps; opening the screen marks everything read
/// (PATCH /api/notifications), same as web.
struct NotificationsView: View {
    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @State private var model = NotificationsViewModel()

    private static let typeIcons: [String: String] = [
        "guestlist_confirmed": "star.fill",
        "guestlist_checkin": "checkmark.circle.fill",
        "booking_confirmed": "ticket.fill",
        "friend_request": "person.badge.plus",
        "friend_accept": "person.2.fill",
        "group_invite": "person.3.fill",
        "group_join": "person.3.fill",
        "group_cancelled": "xmark.circle.fill",
        "waitlist_promoted": "arrow.up.circle.fill",
    ]

    var body: some View {
        Group {
            if model.loading {
                ProgressView(locale.t("common.loading"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.items.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "bell")
                        .font(.system(size: 36))
                        .foregroundStyle(Theme.sand)
                    Text(locale.t("notifications.empty"))
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.stone)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(model.items) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: Self.typeIcons[item.type ?? ""] ?? "bell.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.wine)
                            .frame(width: 32, height: 32)
                            .background(Theme.wine.opacity(0.08), in: .circle)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(.cfSans(14, weight: item.isRead == false ? .semibold : .regular))
                                .foregroundStyle(Theme.ink)
                            if let body = item.body {
                                Text(body)
                                    .font(.cfSans(12))
                                    .foregroundStyle(Theme.stone)
                            }
                            Text(timeAgo(item.createdAt))
                                .font(.cfSans(11))
                                .foregroundStyle(Theme.fadedSand)
                        }

                        Spacer()
                        if item.isRead == false {
                            Circle().fill(Theme.wine).frame(width: 8, height: 8)
                        }
                    }
                    .listRowBackground(Theme.cream)
                }
                .listStyle(.plain)
            }
        }
        .background(Theme.cream)
        .navigationTitle(locale.t("notifications.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(api: api) }
        .refreshable { await model.load(api: api) }
    }

    private func timeAgo(_ iso: String?) -> String {
        guard let iso else { return "" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: iso) ?? {
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: iso)
        }()
        guard let date else { return "" }
        let mins = Int(Date().timeIntervalSince(date) / 60)
        if mins < 1 { return locale.t("time.justNow") }
        if mins < 60 { return String(format: locale.t("time.minsAgo"), mins) }
        let hrs = mins / 60
        if hrs < 24 { return String(format: locale.t("time.hrsAgo"), hrs) }
        return String(format: locale.t("time.daysAgo"), hrs / 24)
    }
}

@MainActor
@Observable
final class NotificationsViewModel {
    private(set) var items: [NotificationItem] = []
    private(set) var loading = true

    func load(api: APIClient) async {
        items = (try? await api.get("/api/notifications") as [NotificationItem]) ?? []
        loading = false
        // Mark all read once displayed, like the web page
        struct Result: Decodable, Sendable { let updated: Bool }
        _ = try? await api.patch("/api/notifications", body: [String: String]()) as Result
    }
}
