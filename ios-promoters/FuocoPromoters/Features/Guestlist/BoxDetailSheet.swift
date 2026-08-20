import SwiftUI

// The series detail sheet, plus the pieces it shares.
//
// Tapping a SERIES card in Tonight/Guestlist opens this: live guest data for
// the current week (who's coming, arrived, agreed to location) plus every
// action for it — open, edit, share, visibility, skip-a-week, delete. All
// reads stay defensive against schema drift.
//
// A one-off night has no sheet: tapping one navigates straight to
// GuestlistView. A NightDetailSheet used to live here and was never presented
// by anything, so edits to it silently did nothing — removed 2026-08-20.

// ── Shared bits ──────────────────────────────────────────────────────────────

private struct SheetStat: View {
    let label: String
    let value: String
    var body: some View {
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
}

/// One guest line: name, party size, arrived, location agreement.
private struct GuestPreviewRow: View {
    let guest: PromoterGuest
    var body: some View {
        HStack(spacing: 10) {
            Text(guest.fullName)
                .font(.cfSans(14, weight: .medium))
                .foregroundStyle(Theme.parchment)
                .lineLimit(1)
            if guest.plusOnes > 0 {
                Text("+\(guest.plusOnes)")
                    .font(.cfMono(10, weight: .medium))
                    .foregroundStyle(Theme.flame)
            }
            Spacer()
            // Location agreement: agreed / declined / unknown (older claims).
            if guest.locationConsent == true {
                Image(systemName: "location.fill")
                    .font(.system(size: 11)).foregroundStyle(Theme.gold)
            } else if guest.locationConsent == false {
                Image(systemName: "location.slash")
                    .font(.system(size: 11)).foregroundStyle(Theme.parchmentDim)
            }
            // Arrival
            Image(systemName: guest.isCheckedIn ? "checkmark.circle.fill" : "circle.dotted")
                .font(.system(size: 13))
                .foregroundStyle(guest.isCheckedIn ? Theme.gold : Theme.parchmentFaint)
        }
        .padding(.vertical, 7)
    }
}

private struct GuestPreviewList: View {
    let guests: [PromoterGuest]
    let loading: Bool
    var emptyText = "Nobody on the list yet."

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Kicker("Who's coming", color: Theme.parchmentDim)
                Spacer()
                if !guests.isEmpty {
                    HStack(spacing: 12) {
                        HStack(spacing: 4) {
                            Image(systemName: "location.fill").font(.system(size: 8))
                            Text("LOCATION OK").font(.cfMono(8)).kerning(1)
                        }
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 8))
                            Text("ARRIVED").font(.cfMono(8)).kerning(1)
                        }
                    }
                    .foregroundStyle(Theme.parchmentDim)
                }
            }
            .padding(.bottom, 6)

            if loading {
                ProgressView().tint(Theme.parchment)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
            } else if guests.isEmpty {
                Text(emptyText)
                    .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                    .padding(.vertical, 10)
            } else {
                ForEach(guests) { g in
                    GuestPreviewRow(guest: g)
                    Divider().background(Theme.hairline)
                }
            }
        }
    }
}

private struct SheetActionRow: View {
    let icon: String
    let title: String
    var tint: Color = Theme.parchment
    let action: () -> Void
    var body: some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(tint == Theme.parchment ? Theme.ember : tint)
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
}

private func statsBlock(joined: Int, capacityLabel: String, guests: [PromoterGuest]) -> some View {
    let arrived = guests.filter(\.isCheckedIn).reduce(0) { $0 + $1.totalCount }
    let consented = guests.filter { $0.locationConsent == true }.count
    let anyConsentKnown = guests.contains { $0.locationConsent != nil }
    return HStack(spacing: 10) {
        SheetStat(label: "Joined", value: "\(joined) / \(capacityLabel)")
        SheetStat(label: "Arrived", value: "\(arrived)")
        SheetStat(label: "Location OK", value: anyConsentKnown ? "\(consented)" : "—")
    }
}

// ── Series sheet ─────────────────────────────────────────────────────────────

struct SeriesDetailSheet: View {
    let series: PromoterSeries
    var onOpenWeek: () -> Void
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onChanged: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var weekAllocation: PromoterAllocation?
    @State private var guests: [PromoterGuest] = []
    @State private var loading = true
    @State private var groupVisible: Bool
    @State private var skipped: Set<String>
    @State private var savingSkips = false
    @State private var skipError: String?

    private let repo = PromoterRepo()

    init(series: PromoterSeries,
         onOpenWeek: @escaping () -> Void,
         onEdit: @escaping () -> Void,
         onDelete: @escaping () -> Void,
         onChanged: @escaping () -> Void = {}) {
        self.series = series
        self.onOpenWeek = onOpenWeek
        self.onEdit = onEdit
        self.onDelete = onDelete
        self.onChanged = onChanged
        _groupVisible = State(initialValue: series.groupVisible)
        _skipped = State(initialValue: Set(series.skippedDates ?? []))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if series.reviewState == .rejected {
                    RejectionNotice(reason: series.rejectionReason)
                }
                skipManager
                if let a = weekAllocation {
                    VStack(alignment: .leading, spacing: 14) {
                        Kicker("This week — \(formatted(a.night?.nightDate))", color: Theme.flame)
                        statsBlock(joined: a.guestCount,
                                   capacityLabel: a.isUnlimited ? "∞" : "\(a.spots)",
                                   guests: guests)
                        GuestPreviewList(guests: guests, loading: false)
                    }
                } else if loading {
                    ProgressView().tint(Theme.parchment)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                } else {
                    Text(series.reviewState == .live || series.reviewState == nil
                         ? "No upcoming date to show yet."
                         : "Guest data appears once the series is approved.")
                        .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                }
                actions
                Spacer(minLength: 20)
            }
            .padding(22)
        }
        .background(Theme.night.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await loadWeek() }
    }

    private func loadWeek() async {
        loading = true
        if let alloc = try? await repo.currentAllocation(forSeries: series.id) {
            weekAllocation = alloc
            guests = (try? await repo.guests(allocationId: alloc.id)) ?? []
        } else {
            weekAllocation = nil
            guests = []
        }
        loading = false
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Text(series.displayTitle)
                    .font(.cfSerif(30)).foregroundStyle(Theme.parchment)
                if let state = series.reviewState { ReviewBadge(state: state) }
            }
            Text("\(series.venueName) · \(series.weekdayLabel)")
                .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
        }
        .padding(.top, 10)
    }

    // ── Skip weeks ───────────────────────────────────────────────────────────

    /// The next six occurrence dates implied by the series' weekdays.
    private var upcomingOccurrences: [String] {
        guard !series.weekdays.isEmpty else { return [] }
        let cal = Calendar.current
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        var out: [String] = []
        var d = cal.startOfDay(for: Date())
        for _ in 0..<60 {
            if series.weekdays.contains(cal.component(.weekday, from: d)) {
                out.append(f.string(from: d))
                if out.count == 6 { break }
            }
            d = cal.date(byAdding: .day, value: 1, to: d) ?? d
        }
        return out
    }

    private var skipManager: some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker("Upcoming dates — tap to skip a week", color: Theme.parchmentDim)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(upcomingOccurrences, id: \.self) { date in
                        let isSkipped = skipped.contains(date)
                        Button { toggleSkip(date) } label: {
                            VStack(spacing: 3) {
                                Text(shortLabel(date))
                                    .font(.cfMono(11, weight: .medium))
                                Text(isSkipped ? "SKIPPED" : "ON")
                                    .font(.cfMono(8, weight: .medium)).kerning(1.2)
                            }
                            .foregroundStyle(isSkipped ? Theme.parchmentDim : Theme.emberCream)
                            .padding(.horizontal, 13).padding(.vertical, 8)
                            .background(RoundedRectangle(cornerRadius: 10)
                                .fill(isSkipped ? Color.clear : Theme.ember))
                            .overlay(RoundedRectangle(cornerRadius: 10)
                                .stroke(isSkipped ? Theme.parchmentFaint : Color.clear))
                            .opacity(savingSkips ? 0.5 : 1)
                        }
                        .disabled(savingSkips)
                    }
                }
            }
            Text("Skipped weeks are removed from your permanent link — it jumps to the next date that's on.")
                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
            if let skipError {
                Text(skipError).font(.cfSans(12)).foregroundStyle(Theme.wine)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func toggleSkip(_ date: String) {
        Haptics.tap()
        skipError = nil
        let previous = skipped
        if skipped.contains(date) { skipped.remove(date) } else { skipped.insert(date) }
        savingSkips = true
        Task {
            do {
                // Prune past dates so the array never grows unbounded.
                let today = Self.dayFormatter.string(from: Date())
                let toSave = skipped.filter { $0 >= today }.sorted()
                try await repo.updateSeriesSkippedDates(seriesId: series.id, dates: toSave)
                Haptics.success()
                onChanged()
                await loadWeek()   // the resolved week may have moved
            } catch {
                skipped = previous
                skipError = "Couldn't save. Skipping weeks needs the latest backend update."
                Haptics.error()
            }
            savingSkips = false
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 0) {
            Kicker("Actions", color: Theme.parchmentDim).padding(.bottom, 4)
            SheetActionRow(icon: "list.bullet.rectangle", title: "Open this week's list") {
                dismiss(); onOpenWeek()
            }
            Divider().background(Theme.hairline)
            SheetActionRow(icon: "pencil", title: "Edit series") {
                dismiss(); onEdit()
            }
            Divider().background(Theme.hairline)
            if let url = URL(string: "https://clubfuoco.com/i/\(series.inviteToken)") {
                ShareLink(item: url) {
                    HStack(spacing: 12) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 15)).foregroundStyle(Theme.ember)
                            .frame(width: 24)
                        Text("Share permanent link")
                            .font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                        Spacer()
                    }
                    .padding(.vertical, 13)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider().background(Theme.hairline)
            }
            Toggle(isOn: $groupVisible) {
                HStack(spacing: 12) {
                    Image(systemName: groupVisible ? "eye" : "eye.slash")
                        .font(.system(size: 15)).foregroundStyle(Theme.ember)
                        .frame(width: 24)
                    Text("Show invitees who else is coming")
                        .font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                }
            }
            .tint(Theme.ember)
            .padding(.vertical, 10)
            .onChange(of: groupVisible) { _, v in
                Task {
                    try? await repo.setSeriesGroupVisible(token: series.inviteToken, visible: v)
                    onChanged()
                }
            }
            Divider().background(Theme.hairline)
            SheetActionRow(icon: "trash", title: "Delete permanent link", tint: Theme.wine) {
                dismiss(); onDelete()
            }
        }
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f
    }()

    private func formatted(_ s: String?) -> String {
        guard let s else { return "" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: s) else { return s }
        let outF = DateFormatter(); outF.dateFormat = "EEE, MMM d"
        return outF.string(from: d)
    }

    private func shortLabel(_ s: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: s) else { return s }
        let outF = DateFormatter(); outF.dateFormat = "EEE d MMM"
        return outF.string(from: d)
    }
}
