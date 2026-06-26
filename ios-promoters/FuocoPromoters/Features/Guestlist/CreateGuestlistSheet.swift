import SwiftUI

enum ScheduleMode: String, CaseIterable, Identifiable {
    case once = "One night"
    case range = "Multi-day event"
    case recurring = "Recurring weekly"
    var id: String { rawValue }
}

@MainActor
final class CreateGuestlistModel: ObservableObject {
    @Published var clubs: [Club] = []
    @Published var loadingClubs = true
    @Published var query = ""
    @Published var selected: Club?
    @Published var title = ""

    // Schedule
    @Published var mode: ScheduleMode = .once
    @Published var startDate = Date()
    @Published var endDate = Calendar.current.date(byAdding: .day, value: 2, to: Date()) ?? Date()
    @Published var recurringUntil = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @Published var recurringIndefinite = false
    /// How far ahead to materialize nights when the user picks "indefinite".
    static let indefiniteHorizonMonths = 6
    /// 1 = Sunday … 7 = Saturday (matches Calendar.weekday)
    @Published var weekdays: Set<Int> = [6] // Fri default
    @Published var setOpenClose = false
    @Published var openTime: Date = CreateGuestlistModel.defaultTime(hour: 22, minute: 0)
    @Published var closeTime: Date = CreateGuestlistModel.defaultTime(hour: 3, minute: 0)

    @Published var spots = 25
    @Published var trackPayouts = false
    @Published var payoutPerGuestText = "10.00"
    @Published var groupVisible = true

    @Published var submitting = false
    @Published var error: String?

    let repo = PromoterRepo()
    let promoterId: UUID
    let onResult: (CreateResult) -> Void

    enum CreateResult {
        case allocation(PromoterAllocation)  // one-off / multi-day
        case series(PromoterSeries)          // permanent recurring link
    }

    init(promoterId: UUID, onResult: @escaping (CreateResult) -> Void) {
        self.promoterId = promoterId
        self.onResult = onResult
    }

    var payoutPerGuestDecimal: Decimal {
        let normalized = payoutPerGuestText.replacingOccurrences(of: ",", with: ".")
        return Decimal(string: normalized) ?? 0
    }

    func loadClubs() async {
        loadingClubs = true
        clubs = (try? await repo.barcelonaClubs()) ?? []
        loadingClubs = false
    }

    var filteredClubs: [Club] {
        guard !query.isEmpty else { return clubs }
        return clubs.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    /// Concrete calendar dates (yyyy-MM-dd) that should be created.
    var generatedDates: [String] {
        let cal = Calendar.current
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        switch mode {
        case .once:
            return [f.string(from: startDate)]
        case .range:
            let start = cal.startOfDay(for: startDate)
            let end = cal.startOfDay(for: endDate)
            guard end >= start else { return [f.string(from: startDate)] }
            var out: [String] = []
            var cur = start
            while cur <= end {
                out.append(f.string(from: cur))
                cur = cal.date(byAdding: .day, value: 1, to: cur) ?? cur
            }
            return out
        case .recurring:
            let start = cal.startOfDay(for: startDate)
            let endSource: Date = recurringIndefinite
                ? (cal.date(byAdding: .month, value: Self.indefiniteHorizonMonths, to: start) ?? start)
                : recurringUntil
            let end = cal.startOfDay(for: endSource)
            guard end >= start, !weekdays.isEmpty else { return [] }
            var out: [String] = []
            var cur = start
            while cur <= end {
                if weekdays.contains(cal.component(.weekday, from: cur)) {
                    out.append(f.string(from: cur))
                }
                cur = cal.date(byAdding: .day, value: 1, to: cur) ?? cur
            }
            return out
        }
    }

    var generationSummary: String {
        if mode == .recurring {
            return weekdays.isEmpty ? "Pick at least one weekday"
                                    : "One permanent link — always opens the next date"
        }
        let count = generatedDates.count
        if count == 0 { return "Pick at least one day" }
        if count == 1 { return "Creates 1 night" }
        return "Creates \(count) nights"
    }

    func create() async {
        guard let club = selected else { return }
        submitting = true; error = nil
        let timeFormatter = DateFormatter(); timeFormatter.dateFormat = "HH:mm:ss"
        let openStr = setOpenClose ? timeFormatter.string(from: openTime) : nil
        let closeStr = setOpenClose ? timeFormatter.string(from: closeTime) : nil
        let payout = trackPayouts ? payoutPerGuestDecimal : 0

        do {
            if mode == .recurring {
                // Permanent link: one series row, no pre-generated nights.
                guard !weekdays.isEmpty else {
                    error = "Pick at least one weekday."; submitting = false; return
                }
                let series = try await repo.createSeries(.init(
                    promoterId: promoterId, clubId: club.id,
                    title: title.isEmpty ? nil : title,
                    weekdays: Array(weekdays).sorted(),
                    openTime: openStr, closeTime: closeStr,
                    spots: spots, payoutPerGuest: payout, groupVisible: groupVisible))
                Haptics.success()
                onResult(.series(series))
            } else {
                let dates = generatedDates
                guard !dates.isEmpty else { error = "Pick at least one day."; submitting = false; return }
                let alloc = try await repo.createSelfGuestlist(
                    clubId: club.id,
                    title: title.isEmpty ? nil : title,
                    dates: dates,
                    openTime: openStr, closeTime: closeStr,
                    spots: spots, payoutPerGuest: payout,
                    groupVisible: groupVisible, promoterId: promoterId)
                Haptics.success()
                onResult(.allocation(alloc))
            }
        } catch {
            self.error = "Couldn't create guestlist. Ask an admin to enable promoter inserts."
            Haptics.error()
        }
        submitting = false
    }

    static func defaultTime(hour: Int, minute: Int) -> Date {
        let cal = Calendar.current
        return cal.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }
}

struct CreateGuestlistSheet: View {
    @Environment(\.dismiss) var dismiss
    @StateObject private var model: CreateGuestlistModel
    @FocusState private var focused: Field?
    enum Field: Hashable { case search, title, payout }

    init(promoterId: UUID, onResult: @escaping (CreateGuestlistModel.CreateResult) -> Void) {
        _model = StateObject(wrappedValue: CreateGuestlistModel(promoterId: promoterId, onResult: onResult))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                if model.selected == nil { clubPicker } else { detailsForm }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.night, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if model.selected != nil {
                        Button("Back") { model.selected = nil }
                            .foregroundStyle(Theme.parchmentDim)
                    } else {
                        Button("Cancel") { dismiss() }
                            .foregroundStyle(Theme.parchmentDim)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text(model.selected == nil ? "Pick a Club" : "New Night")
                        .font(.cfMono(11, weight: .medium))
                        .kerning(2)
                        .foregroundStyle(Theme.flame)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Button("Done") { focused = nil }
                        .foregroundStyle(Theme.ember)
                        .font(.cfSans(15, weight: .semibold))
                    Spacer()
                }
            }
        }
        .task { await model.loadClubs() }
    }

    // MARK: - Club picker

    private var clubPicker: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.parchmentDim)
                TextField("", text: $model.query,
                          prompt: Text("Search Barcelona clubs…").foregroundStyle(Theme.parchmentDim))
                    .font(.cfSans(15))
                    .foregroundStyle(Theme.parchment)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .search)
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.parchment.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline, lineWidth: 1))
            .padding(.horizontal, 20)

            if model.loadingClubs {
                ProgressView().tint(Theme.parchment).padding(.top, 60)
                Spacer()
            } else {
                List {
                    ForEach(model.filteredClubs) { c in
                        Button {
                            Haptics.tap(); model.selected = c
                        } label: {
                            HStack {
                                Text(c.name)
                                    .font(.cfSerif(20))
                                    .foregroundStyle(Theme.parchment)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.parchmentDim)
                            }
                            .padding(.vertical, 8)
                        }
                        .listRowBackground(Theme.night)
                        .listRowSeparatorTint(Theme.hairline)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(Theme.night)
            }
        }
        .padding(.top, 12)
    }

    // MARK: - Details form

    private var detailsForm: some View {
        ScrollView {
            Color.clear.frame(height: 0).contentShape(Rectangle()).onTapGesture { focused = nil }
            VStack(alignment: .leading, spacing: 22) {
                clubHeader
                titleField
                scheduleCard
                hoursCard
                spotsCard
                visibilityCard
                payoutCard

                if let err = model.error {
                    Text(err).font(.cfSans(13)).foregroundStyle(Theme.wine)
                }

                EmberPillButton(title: "Create guestlist", loading: model.submitting) {
                    Task { await model.create() }
                }
                .padding(.top, 8)

                Spacer(minLength: 60)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var clubHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Kicker("Club")
            Text(model.selected?.name ?? "")
                .font(.cfSerif(32))
                .foregroundStyle(Theme.parchment)
        }
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker("Night title (optional)")
            TextField("", text: $model.title,
                      prompt: Text("e.g. Vernissage Night")
                        .foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(16))
                .foregroundStyle(Theme.parchment)
                .textInputAutocapitalization(.words)
                .focused($focused, equals: .title)
                .submitLabel(.done)
                .onSubmit { focused = nil }
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Theme.parchmentFaint).frame(height: 1)
                }
        }
    }

    // MARK: Schedule card

    private var scheduleCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker("Schedule")

            // Mode picker
            HStack(spacing: 6) {
                ForEach(ScheduleMode.allCases) { m in
                    Button {
                        Haptics.tap()
                        withAnimation(.easeInOut(duration: 0.15)) { model.mode = m }
                    } label: {
                        Text(m.rawValue)
                            .font(.cfMono(10, weight: .medium))
                            .kerning(1.2)
                            .foregroundStyle(model.mode == m ? Theme.emberCream : Theme.parchmentDim)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(model.mode == m ? Theme.ember : Color.clear)
                            )
                    }
                }
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.night))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))

            // Mode-specific inputs
            switch model.mode {
            case .once:
                dateRow("Date", binding: $model.startDate)
            case .range:
                VStack(spacing: 6) {
                    dateRow("From", binding: $model.startDate)
                    dateRow("To",   binding: $model.endDate)
                }
            case .recurring:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Repeat on")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                    weekdayPicker
                    Text("Creates a permanent link you can post anywhere. It always opens the next upcoming date — no end date, no re-sharing.")
                        .font(.cfSans(11))
                        .foregroundStyle(Theme.parchmentDim)
                }
            }

            Text(model.generationSummary)
                .font(.cfMono(10, weight: .medium))
                .kerning(1.5)
                .foregroundStyle(Theme.flame)
                .padding(.top, 4)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func dateRow(_ label: String, binding: Binding<Date>) -> some View {
        HStack {
            Text(label).font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
            Spacer()
            DatePicker("", selection: binding, in: Date()..., displayedComponents: .date)
                .datePickerStyle(.compact)
                .labelsHidden()
                .tint(Theme.ember)
        }
    }

    private var weekdayPicker: some View {
        let labels = ["S","M","T","W","T","F","S"]   // index 0 = Sunday (weekday 1)
        return HStack(spacing: 6) {
            ForEach(0..<7) { i in
                let weekday = i + 1
                let on = model.weekdays.contains(weekday)
                Button {
                    Haptics.tap()
                    if on { model.weekdays.remove(weekday) } else { model.weekdays.insert(weekday) }
                } label: {
                    Text(labels[i])
                        .font(.cfMono(13, weight: .medium))
                        .foregroundStyle(on ? Theme.emberCream : Theme.parchmentDim)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(on ? Theme.ember : Color.clear))
                        .overlay(Circle().stroke(on ? Color.clear : Theme.parchmentFaint))
                }
            }
        }
    }

    // MARK: Hours card

    private var hoursCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker("Hours")
            Toggle(isOn: $model.setOpenClose.animation()) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Set open & close times")
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.parchment)
                    Text("Optional — what time the night runs.")
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            .tint(Theme.ember)

            if model.setOpenClose {
                HStack(spacing: 10) {
                    timeBlock("Open",  binding: $model.openTime)
                    timeBlock("Close", binding: $model.closeTime)
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func timeBlock(_ label: String, binding: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.cfMono(9, weight: .medium)).kerning(1.5)
                .foregroundStyle(Theme.flame)
            DatePicker("", selection: binding, displayedComponents: .hourAndMinute)
                .datePickerStyle(.compact)
                .labelsHidden()
                .tint(Theme.ember)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.night))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
    }

    // MARK: Spots / payout

    private var spotsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker("Spots")
            Text("How many guests can you bring per night?")
                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            HStack(spacing: 8) {
                stepButton(label: "−5") { adjustSpots(-5) }
                stepButton(label: "−1") { adjustSpots(-1) }
                Text("\(model.spots)")
                    .font(.cfSerif(28))
                    .foregroundStyle(Theme.parchment)
                    .frame(maxWidth: .infinity)
                stepButton(label: "+1", filled: true) { adjustSpots(+1) }
                stepButton(label: "+5", filled: true) { adjustSpots(+5) }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func adjustSpots(_ delta: Int) {
        let next = model.spots + delta
        if next >= 1 && next <= 200 {
            model.spots = next
            Haptics.tap()
        }
    }

    private func stepButton(label: String, filled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.cfMono(12, weight: .medium))
                .foregroundStyle(filled ? Theme.emberCream : Theme.parchment)
                .frame(width: 44, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(filled ? Theme.ember : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(filled ? Color.clear : Theme.parchmentFaint)
                )
        }
    }

    private var visibilityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker("Invite link visibility")
            Toggle(isOn: $model.groupVisible.animation()) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Show invitees who else is coming")
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.parchment)
                    Text(model.groupVisible
                         ? "Like a group chat — they'll see the full guestlist."
                         : "Each invitee only sees their own ticket.")
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            .tint(Theme.ember)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private var payoutCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker("Payout tracking")
            Toggle(isOn: $model.trackPayouts.animation()) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Track your payouts with us")
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.parchment)
                    Text("You won't be charged at all for it.")
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            .tint(Theme.ember)

            if model.trackPayouts {
                HStack(spacing: 8) {
                    Text("Payout per guest")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                    Spacer()
                    Text("€")
                        .font(.cfSerif(20))
                        .foregroundStyle(Theme.parchmentDim)
                    TextField("0.00", text: $model.payoutPerGuestText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .font(.cfSerif(22))
                        .foregroundStyle(Theme.ember)
                        .frame(width: 90)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.night))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.parchmentFaint))
                        .focused($focused, equals: .payout)
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func stepper(value: Binding<Int>, min: Int, max: Int, step: Int) -> some View {
        HStack(spacing: 12) {
            Button {
                if value.wrappedValue - step >= min { value.wrappedValue -= step; Haptics.tap() }
            } label: {
                Image(systemName: "minus").foregroundStyle(Theme.parchment)
                    .frame(width: 32, height: 32)
                    .background(Circle().stroke(Theme.parchmentFaint))
            }
            Text("\(value.wrappedValue)")
                .font(.cfSerif(22))
                .foregroundStyle(Theme.parchment)
                .frame(minWidth: 40)
            Button {
                if value.wrappedValue + step <= max { value.wrappedValue += step; Haptics.tap() }
            } label: {
                Image(systemName: "plus").foregroundStyle(Theme.emberCream)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Theme.ember))
            }
        }
    }
}
