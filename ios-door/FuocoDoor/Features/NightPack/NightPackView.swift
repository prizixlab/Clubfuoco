import SwiftUI

/// Download tonight's encrypted pack so the door keeps working with no signal.
/// The pack holds no readable guest data — each entry only opens when its own QR
/// is scanned — so caching a night is safe even on a shared device.
struct NightPackView: View {
    @ObservedObject var pack: NightPackStore
    let repo: DoorRepo
    /// The venue this door works. Downloads are scoped to it.
    let session: DeviceSession
    @Environment(\.dismiss) private var dismiss

    @State private var date = Date()
    @State private var venues: [DoorVenue] = []
    @State private var loading = false
    @State private var downloading: String?
    @State private var error: String?

    private var dateString: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: date)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                VStack(spacing: 0) {
                    header
                    if let m = pack.manifest { cached(m) }
                    Divider().overlay(Theme.hairline)
                    list
                }
            }
            .navigationTitle("Offline night")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.flame)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
    }

    private var header: some View {
        VStack(spacing: 12) {
            DatePicker("Night", selection: $date, displayedComponents: .date)
                .datePickerStyle(.compact)
                .tint(Theme.flame)
                .onChange(of: date) { Task { await load() } }
            Text("\(session.venueName) · entries are sealed with each guest's own QR, so this cache can't be read without scanning.")
                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center)
        }
        .padding(16)
    }

    private func cached(_ m: EncryptedManifest) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "lock.doc.fill").foregroundStyle(Theme.admitBright)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(m.venueName) · \(m.night)")
                    .font(.cfSans(13, weight: .semibold)).foregroundStyle(Theme.parchment)
                Text("\(m.entries.count) sealed entries cached")
                    .font(.cfMono(10)).foregroundStyle(Theme.parchmentDim)
            }
            Spacer()
            Button("Clear") { pack.clear() }
                .font(.cfSans(12)).foregroundStyle(Theme.deny)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Theme.nightLift)
    }

    private var list: some View {
        Group {
            if loading {
                Spacer(); ProgressView().tint(Theme.parchment); Spacer()
            } else if let error {
                Spacer()
                Text(error).font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                    .multilineTextAlignment(.center).padding(24)
                Spacer()
            } else if venues.isEmpty {
                Spacer()
                Text("Nothing on that night.")
                    .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(venues) { v in row(v) }
                    }
                }
            }
        }
    }

    private func row(_ v: DoorVenue) -> some View {
        Button {
            Task { await download(v) }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(v.name).font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                    Text("\(v.bookingCount) booking\(v.bookingCount == 1 ? "" : "s")\(v.neighborhood.map { " · \($0)" } ?? "")")
                        .font(.cfMono(10)).foregroundStyle(Theme.parchmentDim)
                }
                Spacer()
                if downloading == v.id {
                    ProgressView().tint(Theme.flame)
                } else {
                    Image(systemName: "arrow.down.circle").foregroundStyle(Theme.flame)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
        }
        .overlay(Rectangle().fill(Theme.hairline).frame(height: 1), alignment: .bottom)
    }

    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            // Only this door's venue — staff can't cache another club's guests.
            venues = try await repo.venues(date: dateString).filter { $0.id == session.venue }
            if venues.isEmpty { error = "Nothing on at \(session.venueName) that night." }
        }
        catch { self.error = "Couldn't load venues. Check your connection." }
    }

    private func download(_ v: DoorVenue) async {
        downloading = v.id
        defer { downloading = nil }
        do {
            let m = try await repo.nightPack(venue: v.id, date: dateString)
            pack.store(m)
            Haptics.success()
        } catch {
            self.error = "Download failed."
            Haptics.error()
        }
    }
}
