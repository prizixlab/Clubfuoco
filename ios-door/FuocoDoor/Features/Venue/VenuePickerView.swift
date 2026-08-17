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
    /// A private event has no club row to pick, so it needs its own way in.
    var onPrivateEvent: (() -> Void)? = nil
    var onPick: (DeviceSession) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var venues: [DoorVenue] = []
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?

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
    }

    private var intro: some View {
        VStack(spacing: 10) {
            Text("Tickets for any other venue will be rejected at this door.")
                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center)

            // A secured event is normally at a warehouse or a roof, so it never
            // appears in this list — there is no club row for it. The promoter's
            // event code is the way in.
            //
            // This string is duplicated in the promoters app's EventCodeCard,
            // which tells the promoter to say it out loud. Change one, change
            // both, or the bouncer is hunting for words that aren't on screen.
            if let onPrivateEvent {
                Button {
                    onPrivateEvent()
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.shield")
                        Text("Working a secured door? Enter its code")
                    }
                    .font(.cfSans(13, weight: .semibold))
                    .foregroundStyle(Theme.gold)
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 12)
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
