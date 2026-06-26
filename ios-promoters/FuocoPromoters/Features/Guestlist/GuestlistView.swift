import SwiftUI

@MainActor
final class GuestlistModel: ObservableObject {
    @Published var guests: [PromoterGuest] = []
    @Published var loading = true
    @Published var query = ""
    @Published var error: String?
    let repo = PromoterRepo()
    let allocation: PromoterAllocation

    init(allocation: PromoterAllocation) { self.allocation = allocation }

    func load() async {
        loading = true; error = nil
        do { guests = try await repo.guests(allocationId: allocation.id) }
        catch { self.error = "Couldn't load guests." }
        loading = false
    }

    /// Silent poll — same data load, no spinner; used by the 15s refresh loop.
    /// Detects newly-arrived guests vs. the previous snapshot so the view can
    /// fire a haptic when an attendee crosses the geofence.
    func pollAndNotifyArrivals() async -> [PromoterGuest] {
        let prevArrived = Set(guests.filter(\.isCheckedIn).map(\.id))
        guard let fresh = try? await repo.guests(allocationId: allocation.id) else {
            return []
        }
        let nowArrived = Set(fresh.filter(\.isCheckedIn).map(\.id))
        let newArrivals = nowArrived.subtracting(prevArrived)
        guests = fresh
        return fresh.filter { newArrivals.contains($0.id) }
    }

    var filtered: [PromoterGuest] {
        guard !query.isEmpty else { return guests }
        return guests.filter { $0.fullName.localizedCaseInsensitiveContains(query) }
    }

    var used: Int { guests.reduce(0) { $0 + $1.totalCount } }
    var checkedIn: Int { guests.filter(\.isCheckedIn).reduce(0) { $0 + $1.totalCount } }

    func add(name: String, plusOnes: Int, note: String?) async {
        do {
            let g = try await repo.addGuest(NewGuest(
                allocationId: allocation.id,
                fullName: name,
                plusOnes: plusOnes,
                note: note?.isEmpty == true ? nil : note))
            guests.insert(g, at: 0)
            Haptics.success()
        } catch {
            self.error = "Couldn't add guest."
            Haptics.error()
        }
    }

    func toggle(_ g: PromoterGuest) async {
        let willCheckIn = !g.isCheckedIn
        do {
            try await repo.toggleCheckIn(guestId: g.id, checkedIn: willCheckIn)
            if let idx = guests.firstIndex(where: { $0.id == g.id }) {
                guests[idx] = PromoterGuest(
                    id: g.id, allocationId: g.allocationId, fullName: g.fullName,
                    plusOnes: g.plusOnes, note: g.note,
                    checkedInAt: willCheckIn ? Date() : nil,
                    createdAt: g.createdAt)
            }
            Haptics.tap()
        } catch {}
    }
}

struct GuestlistView: View {
    @Environment(\.dismiss) var dismiss
    @StateObject private var model: GuestlistModel
    @State private var showAdd = false
    @State private var confirmDelete = false
    @State private var deleting = false
    /// For series occurrences: the permanent series token to show in the share
    /// card instead of this week's per-night allocation token.
    let shareTokenOverride: String?

    init(allocation: PromoterAllocation, shareTokenOverride: String? = nil) {
        _model = StateObject(wrappedValue: GuestlistModel(allocation: allocation))
        self.shareTokenOverride = shareTokenOverride
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    HStack(spacing: 16) {
                        statCard("Used", "\(model.used) / \(model.allocation.spots)")
                        statCard("Checked-in", "\(model.checkedIn)")
                    }

                    InviteShareCard(allocation: model.allocation, tokenOverride: shareTokenOverride)

                    TextField("", text: $model.query,
                              prompt: Text("Search guests…").foregroundStyle(Theme.parchmentDim))
                        .font(.cfSans(15))
                        .foregroundStyle(Theme.parchment)
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.parchment.opacity(0.06)))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline, lineWidth: 1))

                    if model.loading {
                        ProgressView().tint(Theme.parchment).frame(maxWidth: .infinity).padding(.top, 40)
                    } else if model.filtered.isEmpty {
                        Text(model.query.isEmpty ? "No guests yet — tap + to add one."
                                                  : "No matches.")
                            .font(.cfSans(14))
                            .foregroundStyle(Theme.parchmentDim)
                            .padding(.top, 24)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(model.filtered) { g in
                                guestRow(g).onTapGesture { Task { await model.toggle(g) } }
                                Divider().background(Theme.hairline)
                            }
                        }
                    }
                    Divider().background(Theme.hairline).padding(.top, 20)

                    Button(role: .destructive) {
                        Haptics.tap(); confirmDelete = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "trash")
                            Text("Cancel this guestlist")
                                .font(.cfSans(15, weight: .semibold))
                        }
                        .foregroundStyle(Theme.wine)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusPill).stroke(Theme.wine, lineWidth: 1))
                    }
                    .padding(.top, 12)

                    Spacer(minLength: 120)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
            }

            Button(action: { Haptics.tap(); showAdd = true }) {
                HStack(spacing: 8) {
                    Image(systemName: "plus").font(.system(size: 16, weight: .semibold))
                    Text("Add guest").font(.cfSans(14, weight: .semibold))
                }
                .foregroundStyle(Theme.emberCream)
                .padding(.horizontal, 22)
                .padding(.vertical, 14)
                .background(Capsule().fill(Theme.ember))
                .shadow(color: .black.opacity(0.5), radius: 12, y: 6)
            }
            .padding(.trailing, 20)
            .padding(.bottom, 24)
        }
        .background(Theme.night.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.night, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            // Initial load, then poll every 15s while visible. Cancels when
            // SwiftUI tears the view down on dismiss.
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                let arrivals = await model.pollAndNotifyArrivals()
                if !arrivals.isEmpty { Haptics.success() }
            }
        }
        .refreshable { await model.load() }
        .sheet(isPresented: $showAdd) {
            AddGuestSheet { name, plus, note in
                await model.add(name: name, plusOnes: plus, note: note)
            }
            .presentationDetents([.fraction(0.55)])
            .presentationBackground(Theme.nightLift)
        }
        .alert("Cancel this guestlist?", isPresented: $confirmDelete) {
            Button("Keep it", role: .cancel) {}
            Button("Delete", role: .destructive) { Task { await deleteSelf() } }
        } message: {
            Text("\(model.allocation.night?.displayTitle ?? "This night") on \(model.allocation.night?.nightDate ?? "") will be removed along with everyone on the list. This can't be undone.")
        }
        .overlay {
            if deleting {
                ZStack {
                    Color.black.opacity(0.4).ignoresSafeArea()
                    ProgressView().tint(Theme.parchment)
                }
            }
        }
    }

    private func deleteSelf() async {
        deleting = true
        defer { deleting = false }
        do {
            try await PromoterRepo().deleteAllocation(allocationId: model.allocation.id)
            Haptics.success()
            dismiss()
        } catch {
            Haptics.error()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker("Management")
            Text(model.allocation.night?.displayTitle ?? "Guestlist")
                .font(.cfSerif(40))
                .foregroundStyle(Theme.parchment)
            Text(model.allocation.night?.club?.name ?? "")
                .font(.cfSans(13))
                .foregroundStyle(Theme.parchmentDim)
        }
    }

    private func statCard(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            Text(value).font(.cfSerif(28)).foregroundStyle(Theme.ember)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func guestRow(_ g: PromoterGuest) -> some View {
        HStack(spacing: 12) {
            Circle().fill(Theme.parchment.opacity(0.08)).frame(width: 36, height: 36)
                .overlay(Circle().fill(g.isCheckedIn ? Theme.ember : Theme.parchmentFaint)
                    .frame(width: 8, height: 8).offset(x: 12, y: 12))
            VStack(alignment: .leading, spacing: 2) {
                Text(g.fullName).font(.cfSerif(18)).foregroundStyle(Theme.parchment)
                if g.plusOnes > 0 {
                    Text("+\(g.plusOnes) guests").font(.cfSans(11))
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            Spacer()
            Text(g.isCheckedIn ? "ARRIVED" : "PENDING")
                .font(.cfMono(10, weight: .medium))
                .kerning(1.5)
                .foregroundStyle(g.isCheckedIn ? Theme.ember : Theme.parchmentDim)
        }
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

struct AddGuestSheet: View {
    @Environment(\.dismiss) var dismiss
    @State private var name = ""
    @State private var plusOnes = 0
    @State private var note = ""
    @State private var submitting = false
    let onAdd: (String, Int, String?) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                Kicker("New reservation")
                Spacer()
            }
            Text("Add Guest")
                .font(.cfSerif(34))
                .foregroundStyle(Theme.parchment)

            field("Full name") {
                TextField("", text: $name,
                          prompt: Text("Enter guest name").foregroundStyle(Theme.parchmentDim))
                    .font(.cfSans(16)).foregroundStyle(Theme.parchment)
                    .textInputAutocapitalization(.words)
            }

            VStack(alignment: .leading, spacing: 8) {
                Kicker("Plus ones")
                HStack {
                    Text("Additional guests (max 4)")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                    Spacer()
                    Button { if plusOnes > 0 { plusOnes -= 1; Haptics.tap() } } label: {
                        Image(systemName: "minus").foregroundStyle(Theme.parchment)
                            .frame(width: 36, height: 36)
                            .background(Circle().stroke(Theme.parchmentFaint))
                    }
                    Text("\(plusOnes)")
                        .font(.cfSerif(22)).foregroundStyle(Theme.parchment)
                        .frame(minWidth: 28)
                    Button { if plusOnes < 4 { plusOnes += 1; Haptics.tap() } } label: {
                        Image(systemName: "plus").foregroundStyle(Theme.emberCream)
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(Theme.ember))
                    }
                }
            }

            field("Note (optional)") {
                TextField("", text: $note,
                          prompt: Text("Special requirements, table location, etc.")
                            .foregroundStyle(Theme.parchmentDim))
                    .font(.cfSans(14)).foregroundStyle(Theme.parchment)
            }

            Spacer()

            EmberPillButton(title: "Add to list", loading: submitting) {
                guard !name.isEmpty else { return }
                submitting = true
                Task {
                    await onAdd(name, plusOnes, note)
                    submitting = false
                    dismiss()
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func field<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(label)
            content()
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Theme.parchmentFaint).frame(height: 1)
                }
        }
    }
}
