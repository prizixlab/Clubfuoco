import SwiftUI

/// First-run gate: staff pick the venue they work. Everything downstream is
/// scoped to it — you can only cache that venue's nights, and a ticket for
/// anywhere else reads WRONG VENUE rather than being admitted.
///
/// This is the open-access stand-in for device enrollment: no credential, but
/// the door still commits to one club so it can't be used to admit at another.
struct VenuePickerView: View {
    let repo: DoorRepo
    /// Non-nil when changing venue from inside the app (vs. first-run).
    var current: DeviceSession? = nil
    var onPick: (DeviceSession) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var venues: [DoorVenue] = []
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?
    @State private var enteringCode = false

    private var filtered: [DoorVenue] {
        guard !query.isEmpty else { return venues }
        return venues.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                VStack(spacing: 0) {
                    intro
                    // The first thing on the screen, and deliberately OUTSIDE
                    // the list: a secured door has no club row, so it must stay
                    // reachable while the venue list is loading, empty, or
                    // failing. Burying it under a network error is exactly when
                    // someone needs it.
                    eventCodeRow
                    if loading {
                        Spacer(); ProgressView().tint(Theme.parchment); Spacer()
                    } else if let error {
                        Spacer()
                        VStack(spacing: 14) {
                            Text(error).font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                                .multilineTextAlignment(.center)
                            Button("Try again") { Task { await load() } }
                                .font(.cfSans(14, weight: .semibold)).foregroundStyle(Theme.flame)
                        }
                        .padding(24)
                        Spacer()
                    } else {
                        ScrollView { VStack(spacing: 0) { ForEach(filtered) { row($0) } } }
                    }
                }
            }
            .searchable(text: $query, prompt: "Find your venue")
            .navigationTitle(current == nil ? "Choose your venue" : "Change venue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if current != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Cancel") { dismiss() }.foregroundStyle(Theme.parchmentDim)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
        // Owned here rather than handed up to the parent. It used to be a
        // closure the caller had to pass, and ScanView's "change venue" simply
        // didn't pass it — so a door already committed to a club had no route
        // to a secured event at all. Keeping the flow inside the picker means
        // every entry point gets it and none can forget.
        .fullScreenCover(isPresented: $enteringCode) {
            EventCodeView(
                repo: repo,
                onJoined: { joined in
                    enteringCode = false
                    // EventCodeView has already persisted the session; both
                    // callers re-read it from onPick.
                    onPick(joined)
                    dismiss()
                },
                onCancel: { enteringCode = false }
            )
        }
    }

    private var intro: some View {
        Text("Tickets for any other venue will be rejected at this door.")
            .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24).padding(.vertical, 12)
    }

    /// A secured event is usually at a warehouse or a roof, so it never appears
    /// in the venue list — there is no club row for it. This is the only way in,
    /// which is why it leads rather than trailing the list as a footnote.
    ///
    /// The label matches the promoters app's EventCodeCard word for word: the
    /// promoter reads it out, the bouncer looks for it here. Change one, change
    /// both.
    private var eventCodeRow: some View {
        Button {
            Haptics.tap()
            enteringCode = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 18)).foregroundStyle(Theme.gold)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Working a secured door? Enter its code")
                        .font(.cfSans(15, weight: .semibold))
                        .foregroundStyle(Theme.parchment)
                        .multilineTextAlignment(.leading)
                    Text("The promoter gives you a six-character code.")
                        .font(.cfMono(10)).foregroundStyle(Theme.parchmentDim)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12)).foregroundStyle(Theme.parchmentDim)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(Theme.gold.opacity(0.07))
            .contentShape(Rectangle())
        }
        .overlay(Rectangle().fill(Theme.hairline).frame(height: 1), alignment: .bottom)
    }

    private func row(_ v: DoorVenue) -> some View {
        Button {
            Haptics.success()
            let s = DeviceSession(deviceToken: "open", venue: v.id,
                                  venueName: v.name, enrolledAt: Date())
            s.save()
            onPick(s)
            dismiss()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(v.name).font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                    if let n = v.neighborhood {
                        Text(n).font(.cfMono(10)).foregroundStyle(Theme.parchmentDim)
                    }
                }
                Spacer()
                if current?.venue == v.id {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.admitBright)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
        }
        .overlay(Rectangle().fill(Theme.hairline).frame(height: 1), alignment: .bottom)
    }

    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do { venues = try await repo.venues(date: nil) }
        catch { self.error = "Couldn't load venues. Check your connection." }
    }
}
