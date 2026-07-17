import SwiftUI

// Tap-a-box detail sheet for supplier offers: pick one of the offer's next
// valid nights, see who booked through it (name, party size, arrived), and
// manage the offer (edit / deactivate / delete) without leaving the sheet.
// Guest data comes from /api/offers/guests (rumbalist_purchases + linked
// booking check-ins), filtered to this offer's product kind.
struct SupplierOfferDetailSheet: View {
    let offer: SupplierOffer
    let clubName: String
    var onEdit: (() -> Void)?
    var onToggle: (() -> Void)?
    var onDelete: (() -> Void)?
    /// Fired after a per-night toggle, so the list behind the sheet refreshes.
    var onChanged: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var selectedDate: String = ""
    @State private var confirmDeactivate = false
    @State private var confirmDelete = false
    @State private var confirmSkipNight = false
    /// Local copy of the offer's per-night exceptions so the sheet updates the
    /// moment a night is toggled (the parent list reloads behind it).
    @State private var skipped: Set<String> = []
    @State private var nightBusy = false
    @State private var nightError: String?
    @State private var guests: [SupplierGuest] = []
    @State private var loading = true
    @State private var loadError: String?

    private let repo = SupplierRepo()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                dayPicker
                stats
                guestList
                actions
                Spacer(minLength: 20)
            }
            .padding(22)
        }
        .background(Theme.night.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .alert("Deactivate this offer?", isPresented: $confirmDeactivate) {
            Button("No", role: .cancel) { }
            Button("Yes", role: .destructive) {
                Haptics.tap()
                dismiss()
                onToggle?()
            }
        } message: {
            Text("\"\(offer.title)\" at \(clubName) stops being offered on the Club Fuoco app. You can reactivate it any time, and the change goes to Club Fuoco for review first.")
        }
        .alert("Deactivate this night?", isPresented: $confirmSkipNight) {
            Button("No", role: .cancel) { }
            Button("Yes", role: .destructive) {
                Haptics.tap()
                Task { await setNight(skipped: true) }
            }
        } message: {
            Text("\"\(offer.title)\" won't run at \(clubName) on \(Self.longLabel(selectedDate)). The offer keeps running on its other nights, and you can turn this one back on any time.")
        }
        .alert("Delete this offer?", isPresented: $confirmDelete) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) {
                Haptics.tap()
                dismiss()
                onDelete?()
            }
        } message: {
            Text("\"\(offer.title)\" at \(clubName) is removed for good. Deactivate instead if you only want to hide it — that keeps the offer's details. The change goes to Club Fuoco for review first.")
        }
        .task {
            if skipped.isEmpty { skipped = Set(offer.skippedDates ?? []) }
            if selectedDate.isEmpty { selectedDate = upcomingDates.first ?? Self.dayString(Date()) }
            await load()
        }
    }

    // MARK: - Data

    /// The offer's next five valid nights (today included when valid).
    private var upcomingDates: [String] {
        let valid = ValidDays.parse(offer.validDays)
        guard !valid.isEmpty else { return [] }
        let cal = Calendar.current
        var out: [String] = []
        var d = cal.startOfDay(for: Date())
        for _ in 0..<28 {
            if valid.contains(cal.component(.weekday, from: d) - 1) {
                out.append(Self.dayString(d))
                if out.count == 5 { break }
            }
            d = cal.date(byAdding: .day, value: 1, to: d) ?? d
        }
        return out
    }

    /// Toggle the selected night. Applies immediately — this is scheduling, not
    /// a content change, so it doesn't go through the review queue.
    private func setNight(skipped want: Bool) async {
        guard !selectedDate.isEmpty else { return }
        nightBusy = true; nightError = nil
        do {
            try await repo.setNight(offerId: offer.id, date: selectedDate, skipped: want)
            if want { skipped.insert(selectedDate) } else { skipped.remove(selectedDate) }
            Haptics.success()
            onChanged?()
        } catch {
            nightError = (error as? LocalizedError)?.errorDescription ?? "Couldn't update that night."
            Haptics.error()
        }
        nightBusy = false
    }

    private func load() async {
        guard !selectedDate.isEmpty else { loading = false; return }
        loading = true; loadError = nil
        do {
            let all = try await repo.guests(clubId: offer.clubId, date: selectedDate)
            guests = all.filter { $0.productKind == offer.kind }
        } catch {
            guests = []
            loadError = (error as? LocalizedError)?.errorDescription ?? "Couldn't load bookings."
        }
        loading = false
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(offer.title).font(.cfSerif(30)).foregroundStyle(Theme.parchment)
                Text(offer.isVip ? "VIP · €\(Int(offer.priceEur ?? 0))" : "FREE")
                    .font(.cfMono(10, weight: .medium)).kerning(1.2)
                    .foregroundStyle(offer.isVip ? Theme.flame : Theme.ember)
                if !offer.isActive {
                    Text("INACTIVE").font(.cfMono(9, weight: .medium)).kerning(1.2)
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            Text("\(clubName) · \(offer.validDays)")
                .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
        }
        .padding(.top, 10)
    }

    private var dayPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker("Night", color: Theme.parchmentDim)
            if let nightError {
                Text(nightError).font(.cfSans(12)).foregroundStyle(Theme.wine)
            }
            if upcomingDates.isEmpty {
                Text("No valid nights parsed from \"\(offer.validDays)\".")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(upcomingDates, id: \.self) { date in
                            let on = date == selectedDate
                            let off = skipped.contains(date)
                            Button {
                                Haptics.tap()
                                selectedDate = date
                                Task { await load() }
                            } label: {
                                VStack(spacing: 2) {
                                    Text(Self.chipLabel(date))
                                        .font(.cfMono(11, weight: .medium))
                                        .strikethrough(off, color: Theme.parchmentDim)
                                    if off {
                                        Text("OFF")
                                            .font(.cfMono(8, weight: .medium)).kerning(1)
                                            .foregroundStyle(Theme.wine)
                                    }
                                }
                                .foregroundStyle(on ? Theme.emberCream : Theme.parchmentDim)
                                .padding(.horizontal, 13).padding(.vertical, 8)
                                .background(RoundedRectangle(cornerRadius: 10)
                                    .fill(on ? Theme.ember : Color.clear))
                                .overlay(RoundedRectangle(cornerRadius: 10)
                                    .stroke(on ? Color.clear : Theme.parchmentFaint))
                                .opacity(off && !on ? 0.55 : 1)
                            }
                        }
                    }
                }
            }
        }
    }

    private var stats: some View {
        let booked = guests.reduce(0) { $0 + $1.partySize }
        let arrived = guests.filter(\.isArrived).reduce(0) { $0 + $1.partySize }
        return HStack(spacing: 10) {
            statChip("Bookings", "\(guests.count)")
            statChip("People", "\(booked)")
            statChip("Arrived", "\(arrived)")
        }
    }

    private func statChip(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.cfMono(8, weight: .medium)).kerning(1.2)
                .foregroundStyle(Theme.parchmentDim)
            Text(value)
                .font(.cfMono(13, weight: .medium))
                .foregroundStyle(Theme.parchment)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.hairline))
    }

    private var guestList: some View {
        VStack(alignment: .leading, spacing: 2) {
            Kicker("Who's coming", color: Theme.parchmentDim).padding(.bottom, 6)
            if loading {
                ProgressView().tint(Theme.parchment)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
            } else if let loadError {
                Text(loadError).font(.cfSans(13)).foregroundStyle(Theme.wine)
                    .padding(.vertical, 10)
            } else if guests.isEmpty {
                Text("No bookings for this night yet.")
                    .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                    .padding(.vertical, 10)
            } else {
                ForEach(guests) { g in
                    HStack(spacing: 10) {
                        Text(g.displayName)
                            .font(.cfSans(14, weight: .medium))
                            .foregroundStyle(Theme.parchment)
                            .lineLimit(1)
                        if g.partySize > 1 {
                            Text("×\(g.partySize)")
                                .font(.cfMono(10, weight: .medium))
                                .foregroundStyle(Theme.flame)
                        }
                        Spacer()
                        if let price = g.priceEur, price > 0 {
                            Text("€\(Int(price))")
                                .font(.cfMono(10, weight: .medium))
                                .foregroundStyle(Theme.flame)
                        }
                        Image(systemName: g.isArrived ? "checkmark.circle.fill" : "circle.dotted")
                            .font(.system(size: 13))
                            .foregroundStyle(g.isArrived ? Theme.gold : Theme.parchmentFaint)
                    }
                    .padding(.vertical, 7)
                    Divider().background(Theme.hairline)
                }
            }
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 0) {
            Kicker("Actions", color: Theme.parchmentDim).padding(.bottom, 4)
            if let onEdit {
                actionRow(icon: "pencil", title: "Edit offer", tint: Theme.parchment) {
                    dismiss(); onEdit()
                }
                Divider().background(Theme.hairline)
            }
            // Turn just the SELECTED night off, leaving the offer itself alone.
            // Whichever chip is picked above is the night this acts on.
            if !selectedDate.isEmpty {
                let isOff = skipped.contains(selectedDate)
                actionRow(icon: isOff ? "calendar.badge.plus" : "calendar.badge.minus",
                          title: isOff
                            ? "Reactivate \(Self.longLabel(selectedDate))"
                            : "Deactivate \(Self.longLabel(selectedDate))",
                          tint: Theme.parchment) {
                    if isOff { Task { await setNight(skipped: false) } }
                    else { confirmSkipNight = true }
                }
                Divider().background(Theme.hairline)
            }
            if let onToggle {
                actionRow(icon: offer.isActive ? "eye.slash" : "eye",
                          title: offer.isActive ? "Deactivate offer" : "Reactivate offer",
                          tint: Theme.parchment) {
                    // Deactivating pulls the offer off the Club Fuoco app, and
                    // it's one tap next to Edit — confirm it. Reactivating is
                    // additive, so it goes straight through.
                    if offer.isActive {
                        confirmDeactivate = true
                    } else {
                        dismiss(); onToggle()
                    }
                }
                Divider().background(Theme.hairline)
            }
            if onDelete != nil {
                actionRow(icon: "trash", title: "Delete offer", tint: Theme.wine) {
                    confirmDelete = true
                }
            }
        }
    }

    private func actionRow(icon: String, title: String, tint: Color,
                           action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(tint == Theme.wine ? Theme.wine : Theme.ember)
                    .frame(width: 24)
                Text(title)
                    .font(.cfSans(15, weight: .medium))
                    .foregroundStyle(tint)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12)).foregroundStyle(Theme.parchmentFaint)
            }
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Dates

    private static func dayString(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: d)
    }

    /// "Monday 20 July" — the action names the exact night it acts on.
    static func longLabel(_ s: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: s) else { return s }
        let outF = DateFormatter(); outF.dateFormat = "EEEE d MMMM"
        return outF.string(from: d)
    }

    private static func chipLabel(_ s: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: s) else { return s }
        if Calendar.current.isDateInToday(d) { return "Tonight" }
        let outF = DateFormatter(); outF.dateFormat = "EEE d MMM"
        return outF.string(from: d)
    }
}
