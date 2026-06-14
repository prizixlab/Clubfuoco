import SwiftUI
import Observation

/// Native port of the friends page: serif search field, debounced user
/// search with relationship-aware actions, Requests / Sent / Your Friends
/// sections. All via /api/friends/**.
struct FriendsView: View {
    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @State private var model = FriendsViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Add a friend
                VStack(alignment: .leading, spacing: 8) {
                    Kicker(locale.t("friends.addFriend"), color: Theme.fadedSand, size: 9)
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 17))
                            .foregroundStyle(model.query.isEmpty ? Theme.fadedSand : Theme.wine)
                        TextField(locale.t("friends.searchPlaceholder"), text: $model.query)
                            .font(.cfSerif(20, italic: true))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .onChange(of: model.query) {
                                model.scheduleSearch(api: api)
                            }
                        if !model.query.isEmpty {
                            Button {
                                model.query = ""
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.fadedSand)
                                    .frame(width: 28, height: 28)
                                    .background(Color(hex: 0x221E1A).opacity(0.05), in: .circle)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 56)
                    .background(Color.white, in: .rect(cornerRadius: Theme.radiusCard))
                    .shadow(color: Color(hex: 0x221E1A).opacity(0.08), radius: 14, y: 8)
                }

                // Search results
                if model.query.trimmingCharacters(in: .whitespaces).count >= 2 {
                    VStack(alignment: .leading, spacing: 0) {
                        if model.searching {
                            Text(locale.t("friends.searching"))
                                .font(.cfSans(13))
                                .foregroundStyle(Theme.fadedSand)
                        } else if model.results.isEmpty {
                            Text(String(format: locale.t("friends.noneFound"), model.query.trimmingCharacters(in: .whitespaces)))
                                .font(.cfSans(13))
                                .foregroundStyle(Theme.fadedSand)
                        } else {
                            ForEach(model.results) { result in
                                row(name: result.fullName, avatar: result.avatarUrl, initials: result.initials) {
                                    searchAction(result)
                                }
                            }
                        }
                    }
                }

                if let error = model.errorMessage {
                    FormError(message: error)
                        .padding(12)
                        .background(Theme.wine.opacity(0.08), in: .rect(cornerRadius: 12))
                }

                // Incoming requests
                if !model.incoming.isEmpty {
                    section(locale.t("friends.requests"), count: model.incoming.count) {
                        ForEach(model.incoming) { friend in
                            row(name: friend.fullName, avatar: friend.avatarUrl, initials: friend.initials) {
                                HStack(spacing: 8) {
                                    actionButton(locale.t("friends.accept"), filled: true, busy: model.busy == friend.friendshipId.uuidString) {
                                        model.respond(friend.friendshipId, action: "accept", api: api)
                                    }
                                    actionButton(locale.t("friends.decline"), filled: false, busy: model.busy == friend.friendshipId.uuidString) {
                                        model.respond(friend.friendshipId, action: "decline", api: api)
                                    }
                                }
                            }
                        }
                    }
                }

                // Outgoing
                if !model.outgoing.isEmpty {
                    section(locale.t("friends.sent"), count: model.outgoing.count) {
                        ForEach(model.outgoing) { friend in
                            row(name: friend.fullName, avatar: friend.avatarUrl, initials: friend.initials) {
                                tag(locale.t("friends.pending"))
                            }
                        }
                    }
                }

                // Friends
                section(locale.t("friends.yourFriends"), count: model.friends.count) {
                    if model.loading {
                        Text(locale.t("common.loading"))
                            .font(.cfSans(13))
                            .foregroundStyle(Theme.fadedSand)
                    } else if model.friends.isEmpty {
                        Text(locale.t("friends.empty"))
                            .font(.cfSerif(14, italic: true))
                            .foregroundStyle(Theme.stone)
                    } else {
                        ForEach(model.friends) { friend in
                            row(name: friend.fullName, avatar: friend.avatarUrl, initials: friend.initials) {
                                Button {
                                    model.remove(friend.friendshipId, api: api)
                                } label: {
                                    Image(systemName: "person.badge.minus")
                                        .font(.system(size: 16))
                                        .foregroundStyle(Theme.fadedSand)
                                }
                                .disabled(model.busy == friend.friendshipId.uuidString)
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.cream)
        .navigationTitle(locale.t("friends.title"))
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .task {
            await model.load(api: api)
            #if DEBUG
            // Simulator automation: prefill the search box
            if let q = ProcessInfo.processInfo.environment["CF_TEST_FRIENDS_QUERY"] {
                model.query = q
                model.scheduleSearch(api: api)
            }
            #endif
        }
        .refreshable { await model.load(api: api) }
    }

    @ViewBuilder
    private func searchAction(_ result: FriendSearchResult) -> some View {
        switch result.relation {
        case "friends":
            tag(locale.t("friends.friends"))
        case "outgoing":
            tag(locale.t("friends.requested"))
        case "incoming":
            if let friendshipId = result.friendshipId {
                actionButton(locale.t("friends.accept"), filled: true, busy: model.busy == friendshipId.uuidString) {
                    model.respond(friendshipId, action: "accept", api: api)
                }
            }
        default:
            actionButton(locale.t("friends.add"), filled: true, busy: model.busy == result.id.uuidString) {
                model.sendRequest(to: result.id, api: api)
            }
        }
    }

    // ── Pieces ────────────────────────────────────────────────────────────────

    private func section(_ title: String, count: Int, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(count > 0 ? "\(title) · \(count)" : title, color: Theme.fadedSand, size: 9)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            content()
        }
    }

    private func row(name: String?, avatar: String?, initials: String, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Theme.wine.opacity(0.08))
                .frame(width: 44, height: 44)
                .overlay {
                    if let avatar, let url = URL(string: avatar) {
                        AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color.clear }
                            .clipShape(.circle)
                    } else {
                        Text(initials)
                            .font(.cfSerif(17, italic: true))
                            .foregroundStyle(Theme.wine)
                    }
                }

            Text(name ?? locale.t("profile.member"))
                .font(.cfSerif(19))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)

            Spacer()
            trailing()
        }
        .padding(.vertical, 10)
    }

    private func actionButton(_ title: String, filled: Bool, busy: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Text(title)
                .font(.cfSans(12, weight: .semibold))
                .foregroundStyle(filled ? Theme.cream : Theme.stone)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(filled ? Theme.ink : .clear, in: .capsule)
                .overlay {
                    if !filled {
                        Capsule().stroke(Theme.hairline)
                    }
                }
                .opacity(busy ? 0.5 : 1)
        }
        .disabled(busy)
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(.cfSans(11, weight: .semibold))
            .foregroundStyle(Theme.fadedSand)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(hex: 0x221E1A).opacity(0.05), in: .capsule)
    }
}

// ── View model ────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class FriendsViewModel {
    private(set) var friends: [FriendUser] = []
    private(set) var incoming: [FriendUser] = []
    private(set) var outgoing: [FriendUser] = []
    private(set) var results: [FriendSearchResult] = []
    private(set) var loading = true
    private(set) var searching = false
    private(set) var busy: String?
    var errorMessage: String?
    var query = ""

    private var searchTask: Task<Void, Never>?

    func load(api: APIClient) async {
        errorMessage = nil
        do {
            let data: FriendsData = try await api.get("/api/friends")
            friends = data.friends
            incoming = data.incoming
            outgoing = data.outgoing
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    /// Debounced search (300ms, ≥2 chars) — mirrors the web behavior.
    func scheduleSearch(api: APIClient) {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            results = []
            searching = false
            return
        }
        searching = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                let found: [FriendSearchResult] = try await api.get(
                    "/api/friends/search",
                    query: [URLQueryItem(name: "q", value: q)]
                )
                if !Task.isCancelled { results = found }
            } catch {
                // Search failures stay quiet, like the web page
            }
            searching = false
        }
    }

    func sendRequest(to userId: UUID, api: APIClient) {
        busy = userId.uuidString
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable { let addresseeId: String }
                struct Result: Decodable, Sendable { let status: String }
                let _: Result = try await api.post("/api/friends", body: Body(addresseeId: userId.uuidString.lowercased()))
                results = results.map { r in
                    guard r.id == userId else { return r }
                    return FriendSearchResult(id: r.id, fullName: r.fullName, avatarUrl: r.avatarUrl, relation: "outgoing", friendshipId: r.friendshipId)
                }
                await load(api: api)
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = nil
        }
    }

    func respond(_ friendshipId: UUID, action: String, api: APIClient) {
        busy = friendshipId.uuidString
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable { let friendshipId: String; let action: String }
                struct Result: Decodable, Sendable { let status: String }
                let _: Result = try await api.post(
                    "/api/friends/respond",
                    body: Body(friendshipId: friendshipId.uuidString.lowercased(), action: action)
                )
                Haptics.success()
            } catch {
                errorMessage = error.localizedDescription
            }
            await load(api: api)
            busy = nil
        }
    }

    func remove(_ friendshipId: UUID, api: APIClient) {
        busy = friendshipId.uuidString
        errorMessage = nil
        Task {
            do {
                struct Body: Encodable { let friendshipId: String }
                struct Result: Decodable, Sendable { let removed: Bool }
                let _: Result = try await api.delete("/api/friends", body: Body(friendshipId: friendshipId.uuidString.lowercased()))
            } catch {
                errorMessage = error.localizedDescription
            }
            await load(api: api)
            busy = nil
        }
    }
}
