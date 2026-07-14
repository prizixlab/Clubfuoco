import SwiftUI
import Observation

/// The group's night thread: coordinate meet-up spot / time / "running late".
/// Members-only (gated server-side). No push yet, so while the thread is open
/// we poll for new messages every few seconds; unread is shown on the group.
struct GroupChatView: View {
    let groupId: UUID
    let clubName: String

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleStore.self) private var locale
    @State private var model = GroupChatModel()
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            messages
            composer
        }
        .background(Theme.cream)
        .navigationTitle(clubName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(locale.t("common.done")) { dismiss() }
                    .foregroundStyle(Theme.ink)
            }
        }
        .task { await model.start(groupId: groupId, api: api) }
        .onDisappear { model.stop() }
    }

    // ── Thread ────────────────────────────────────────────────────────────────

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if model.messages.isEmpty && !model.loading {
                    Text(locale.t("groupChat.empty"))
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.stone)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(Array(model.messages.enumerated()), id: \.element.id) { index, msg in
                            bubble(msg, showSender: showSender(at: index))
                                .id(msg.id)
                        }
                        Color.clear.frame(height: 1).id(Self.bottomAnchor)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                }
            }
            .onChange(of: model.messages.count) {
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
                }
            }
            .onChange(of: composerFocused) {
                if composerFocused {
                    proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
                }
            }
        }
    }

    private static let bottomAnchor = "chat-bottom"

    /// Show the sender name/avatar only at the start of a run from one person.
    private func showSender(at index: Int) -> Bool {
        let msg = model.messages[index]
        if msg.isMine { return false }
        guard index > 0 else { return true }
        return model.messages[index - 1].userId != msg.userId
    }

    private func bubble(_ msg: GroupMessage, showSender: Bool) -> some View {
        HStack {
            if msg.isMine { Spacer(minLength: 40) }
            VStack(alignment: msg.isMine ? .trailing : .leading, spacing: 2) {
                if showSender {
                    Text(msg.shortName)
                        .font(.cfSans(11, weight: .semibold))
                        .foregroundStyle(Theme.fadedSand)
                        .padding(.leading, 4)
                }
                Text(msg.body)
                    .font(.cfSans(15))
                    .foregroundStyle(msg.isMine ? Theme.cream : Theme.ink)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background(
                        msg.isMine ? Theme.wine : Color.white,
                        in: .rect(cornerRadius: 16)
                    )
                Text(Self.timeLabel(msg.createdAt))
                    .font(.cfSans(10))
                    .foregroundStyle(Theme.fadedSand)
                    .padding(.horizontal, 4)
            }
            if !msg.isMine { Spacer(minLength: 40) }
        }
    }

    // ── Composer ──────────────────────────────────────────────────────────────

    private var composer: some View {
        HStack(spacing: 10) {
            TextField(locale.t("groupChat.placeholder"), text: $draft, axis: .vertical)
                .font(.cfSans(15))
                .foregroundStyle(Theme.ink)
                .lineLimit(1...4)
                .focused($composerFocused)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.white, in: .capsule)

            Button {
                send()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.cream)
                    .frame(width: 38, height: 38)
                    .background(canSend ? Theme.ink : Theme.fadedSand, in: .circle)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.cream)
        .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.sending
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Haptics.tap()
        draft = ""
        Task { await model.send(body: text, groupId: groupId, api: api) }
    }

    // ISO-8601 timestamp → short local time (HH:mm). PostgREST may or may not
    // include fractional seconds, so try both.
    private static func timeLabel(_ iso: String) -> String {
        let withFrac = ISO8601DateFormatter()
        withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        guard let date = withFrac.date(from: iso) ?? plain.date(from: iso) else { return "" }
        let out = DateFormatter()
        out.timeStyle = .short
        out.dateStyle = .none
        return out.string(from: date)
    }
}

@MainActor
@Observable
final class GroupChatModel {
    private(set) var messages: [GroupMessage] = []
    private(set) var loading = false
    private(set) var sending = false
    var errorMessage: String?

    private var pollTask: Task<Void, Never>?

    /// Load the thread, then poll for new messages every 5s while it's open.
    func start(groupId: UUID, api: APIClient) async {
        loading = true
        await loadInitial(groupId: groupId, api: api)
        loading = false

        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if Task.isCancelled { return }
                await self?.fetchNew(groupId: groupId, api: api)
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func loadInitial(groupId: UUID, api: APIClient) async {
        do {
            let path = "/api/groups/\(groupId.uuidString.lowercased())/messages"
            messages = try await api.get(path)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Poll only for messages after the last one we hold (server `since` filter).
    private func fetchNew(groupId: UUID, api: APIClient) async {
        guard let last = messages.last?.createdAt else {
            await loadInitial(groupId: groupId, api: api)
            return
        }
        do {
            let path = "/api/groups/\(groupId.uuidString.lowercased())/messages"
            let fresh: [GroupMessage] = try await api.get(path, query: [URLQueryItem(name: "since", value: last)])
            appendUnique(fresh)
        } catch {
            // Transient poll failures stay quiet.
        }
    }

    func send(body: String, groupId: UUID, api: APIClient) async {
        sending = true
        defer { sending = false }
        do {
            struct Body: Encodable { let body: String }
            let path = "/api/groups/\(groupId.uuidString.lowercased())/messages"
            let sent: GroupMessage = try await api.post(path, body: Body(body: body))
            appendUnique([sent])
            Haptics.success()
        } catch {
            Haptics.error()
            errorMessage = error.localizedDescription
        }
    }

    private func appendUnique(_ incoming: [GroupMessage]) {
        let have = Set(messages.map(\.id))
        let additions = incoming.filter { !have.contains($0.id) }
        guard !additions.isEmpty else { return }
        messages.append(contentsOf: additions)
    }
}
