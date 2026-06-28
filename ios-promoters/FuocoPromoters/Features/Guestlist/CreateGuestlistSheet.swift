import SwiftUI
import CoreLocation
import PhotosUI
import UIKit

enum ScheduleMode: String, CaseIterable, Identifiable {
    case once = "One night"
    case range = "Multi-day event"
    case recurring = "Recurring weekly"
    var id: String { rawValue }
}

enum LocationMode { case none, club, custom }

@MainActor
final class CreateGuestlistModel: ObservableObject {
    @Published var clubs: [Club] = []
    @Published var loadingClubs = true
    @Published var query = ""
    @Published var selected: Club?
    @Published var title = ""

    // Location
    @Published var locationMode: LocationMode = .none
    @Published var customName = ""
    @Published var customAddress = ""
    @Published var customCoord: CLLocationCoordinate2D?
    @Published var customConfirmed = false
    @Published var autoCheckin = true   // mandatory geo check-in, on by default

    /// True once the promoter has picked a club or confirmed a custom pin.
    var locationChosen: Bool { selected != nil || customConfirmed }

    var venueLabel: String {
        if let c = selected { return c.name }
        if customConfirmed { return customName.isEmpty ? "Custom location" : customName }
        return ""
    }

    var resolvedLocation: PromoterRepo.EventLocation {
        if let c = selected { return .init(clubId: c.id) }
        return .init(clubId: nil,
                     name: customName.isEmpty ? "Custom location" : customName,
                     address: customAddress.isEmpty ? nil : customAddress,
                     lat: customCoord?.latitude, lng: customCoord?.longitude)
    }

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
    @Published var unlimitedSpots = false

    // Description / theme / photos
    @Published var eventDescription = ""
    @Published var theme = ""
    @Published var themeTranslate = false
    @Published var photoURLs: [String] = []
    @Published var uploadingPhotos = false
    @Published var featured = false   // paid front-page promotion
    @Published var billing: PromoterRepo.BillingStatus?
    @Published var checkingCard = false

    func refreshBilling() async {
        billing = try? await repo.billingStatus()
    }

    var cardOnFile: Bool { billing?.cardVerified == true }

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

    /// Load picked photos, downscale to JPEG, upload to storage, store URLs.
    func uploadPhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        uploadingPhotos = true
        defer { uploadingPhotos = false }
        for item in items {
            guard photoURLs.count < 6,
                  let data = try? await item.loadTransferable(type: Data.self),
                  let jpeg = Self.downscaledJPEG(data) else { continue }
            if let url = try? await repo.uploadEventPhoto(jpeg, promoterId: promoterId) {
                photoURLs.append(url)
            }
        }
    }

    static func downscaledJPEG(_ data: Data, maxDimension: CGFloat = 1600, quality: CGFloat = 0.8) -> Data? {
        guard let img = UIImage(data: data) else { return nil }
        let scale = min(1, maxDimension / max(img.size.width, img.size.height))
        if scale >= 1 { return img.jpegData(compressionQuality: quality) }
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: quality)
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
        guard locationChosen else { return }
        // Front-page promotion requires a verified card on file.
        if featured && !cardOnFile {
            error = "Add a payment method to feature this event on the home screen."
            return
        }
        submitting = true; error = nil
        let timeFormatter = DateFormatter(); timeFormatter.dateFormat = "HH:mm:ss"
        let openStr = setOpenClose ? timeFormatter.string(from: openTime) : nil
        let closeStr = setOpenClose ? timeFormatter.string(from: closeTime) : nil
        let payout = trackPayouts ? payoutPerGuestDecimal : 0
        let loc = resolvedLocation
        let spotsValue = unlimitedSpots ? SpotsLimit.unlimited : spots
        let desc = eventDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let themeVal = theme.trimmingCharacters(in: .whitespaces)
        let translateVal = !themeVal.isEmpty && themeTranslate

        do {
            if mode == .recurring {
                // Permanent link: one series row, no pre-generated nights.
                guard !weekdays.isEmpty else {
                    error = "Pick at least one weekday."; submitting = false; return
                }
                let series = try await repo.createSeries(.init(
                    promoterId: promoterId, clubId: loc.clubId,
                    title: title.isEmpty ? nil : title,
                    weekdays: Array(weekdays).sorted(),
                    openTime: openStr, closeTime: closeStr,
                    spots: spotsValue, payoutPerGuest: payout, groupVisible: groupVisible,
                    locationName: loc.name, address: loc.address,
                    lat: loc.lat, lng: loc.lng, autoCheckin: autoCheckin,
                    description: desc.isEmpty ? nil : desc,
                    theme: themeVal.isEmpty ? nil : themeVal,
                    themeTranslate: translateVal, photoUrls: photoURLs,
                    featured: featured))
                Haptics.success()
                onResult(.series(series))
            } else {
                let dates = generatedDates
                guard !dates.isEmpty else { error = "Pick at least one day."; submitting = false; return }
                let alloc = try await repo.createSelfGuestlist(
                    location: loc,
                    title: title.isEmpty ? nil : title,
                    dates: dates,
                    openTime: openStr, closeTime: closeStr,
                    spots: spotsValue, payoutPerGuest: payout,
                    groupVisible: groupVisible, autoCheckin: autoCheckin,
                    description: desc.isEmpty ? nil : desc,
                    theme: themeVal.isEmpty ? nil : themeVal,
                    themeTranslate: translateVal, photoUrls: photoURLs,
                    featured: featured, promoterId: promoterId)
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
    enum Field: Hashable { case search, title, payout, theme, description }
    @State private var photoItems: [PhotosPickerItem] = []
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    init(promoterId: UUID, onResult: @escaping (CreateGuestlistModel.CreateResult) -> Void) {
        _model = StateObject(wrappedValue: CreateGuestlistModel(promoterId: promoterId, onResult: onResult))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                if model.locationChosen {
                    detailsForm
                } else {
                    switch model.locationMode {
                    case .none:   locationChooser
                    case .club:   clubPicker
                    case .custom: CustomLocationView(model: model)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.night, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(backLabel) { goBack() }
                        .foregroundStyle(Theme.parchmentDim)
                }
                ToolbarItem(placement: .principal) {
                    Text(navTitle)
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
        .task { await model.loadClubs(); await model.refreshBilling() }
        .onChange(of: scenePhase) { _, phase in
            // Re-check card status when returning from the Stripe browser flow.
            if phase == .active { Task { await model.refreshBilling() } }
        }
    }

    private var navTitle: String {
        if model.locationChosen { return "New Night" }
        switch model.locationMode {
        case .none: return "Where's the night?"
        case .club: return "Pick a Club"
        case .custom: return "Custom Location"
        }
    }
    private var backLabel: String { (model.locationChosen || model.locationMode != .none) ? "Back" : "Cancel" }
    private func goBack() {
        if model.locationChosen {
            // back to location choice
            model.selected = nil
            model.customConfirmed = false
        } else if model.locationMode != .none {
            model.locationMode = .none
        } else {
            dismiss()
        }
    }

    // MARK: - Location chooser

    private var locationChooser: some View {
        VStack(spacing: 16) {
            Spacer()
            chooserCard(icon: "building.2", title: "Club",
                        sub: "Pick from Barcelona venues") {
                model.locationMode = .club
            }
            chooserCard(icon: "mappin.and.ellipse", title: "Custom location",
                        sub: "Drop a pin for a villa, rooftop, or party") {
                model.locationMode = .custom
            }
            Spacer()
        }
        .padding(24)
    }

    private func chooserCard(icon: String, title: String, sub: String, action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Theme.ember.opacity(0.15)).frame(width: 52, height: 52)
                    Image(systemName: icon).font(.system(size: 22)).foregroundStyle(Theme.ember)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.cfSerif(22)).foregroundStyle(Theme.parchment)
                    Text(sub).font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.parchmentDim)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 18).fill(Theme.nightLift))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.hairline))
        }
        .buttonStyle(.plain)
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
                descriptionField
                themeCard
                photosCard
                featuredCard
                scheduleCard
                hoursCard
                spotsCard
                autoCheckinCard
                visibilityCard
                payoutCard

                if let err = model.error {
                    Text(err).font(.cfSans(13)).foregroundStyle(Theme.wine)
                }

                let needsCard = model.featured && !model.cardOnFile
                EmberPillButton(title: "Create guestlist", loading: model.submitting) {
                    Task { await model.create() }
                }
                .padding(.top, 8)
                .disabled(needsCard)
                .opacity(needsCard ? 0.4 : 1)

                if needsCard {
                    Text("Add a payment method above to feature this event.")
                        .font(.cfSans(12)).foregroundStyle(Theme.flame)
                        .frame(maxWidth: .infinity)
                }

                Spacer(minLength: 60)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var clubHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Kicker(model.selected != nil ? "Club" : "Location")
            Text(model.venueLabel)
                .font(.cfSerif(32))
                .foregroundStyle(Theme.parchment)
            if model.selected == nil, !model.customAddress.isEmpty {
                Text(model.customAddress)
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
        }
    }

    private var descriptionField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker("Description (optional)")
            TextField("", text: $model.eventDescription,
                      prompt: Text("What the night is about — the vibe, the music, the crowd.")
                        .foregroundStyle(Theme.parchmentDim),
                      axis: .vertical)
                .lineLimit(3...6)
                .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                .focused($focused, equals: .description)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.parchment.opacity(0.06)))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
        }
    }

    private var themeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker("Theme (optional)")
            TextField("", text: $model.theme,
                      prompt: Text("e.g. Masquerade, All-white, 90s house")
                        .foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(16)).foregroundStyle(Theme.parchment)
                .focused($focused, equals: .theme)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }

            if !model.theme.trimmingCharacters(in: .whitespaces).isEmpty {
                Toggle(isOn: $model.themeTranslate.animation()) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Translate the theme for guests")
                            .font(.cfSans(14, weight: .medium))
                            .foregroundStyle(Theme.parchment)
                        Text("Show it in each guest's language (EN / ES).")
                            .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                    }
                }
                .tint(Theme.ember)
                .padding(.top, 4)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private var photosCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker("Event photos (optional)")

            if !model.photoURLs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(model.photoURLs.enumerated()), id: \.offset) { idx, url in
                            ZStack(alignment: .topTrailing) {
                                AsyncImage(url: URL(string: url)) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: {
                                    Rectangle().fill(Theme.night)
                                }
                                .frame(width: 96, height: 96)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                Button {
                                    model.photoURLs.remove(at: idx)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.white, .black.opacity(0.5))
                                        .font(.system(size: 18))
                                }
                                .padding(4)
                            }
                        }
                    }
                }
            }

            PhotosPicker(selection: $photoItems, maxSelectionCount: 6,
                         matching: .images, photoLibrary: .shared()) {
                HStack(spacing: 8) {
                    if model.uploadingPhotos {
                        ProgressView().tint(Theme.parchment).scaleEffect(0.8)
                    } else {
                        Image(systemName: "photo.badge.plus")
                    }
                    Text(model.uploadingPhotos ? "Uploading…" : "Add photos")
                        .font(.cfSans(14, weight: .medium))
                }
                .foregroundStyle(Theme.parchment)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusPill).stroke(Theme.parchmentFaint))
            }
            .onChange(of: photoItems) { _, items in
                Task { await model.uploadPhotos(items); photoItems = [] }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private var featuredCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles").font(.system(size: 13)).foregroundStyle(Theme.flame)
                Kicker("Front-page promotion", color: Theme.flame)
            }
            Toggle(isOn: $model.featured.animation()) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Feature on the Fuoco home screen")
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.parchment)
                    Text("Put this night in front of every Fuoco member when they open the app.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
            }
            .tint(Theme.ember)

            if model.featured {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "eurosign.circle").font(.system(size: 13)).foregroundStyle(Theme.flame)
                    Text("**€0.30 per guest who accepts**, billed one week after midnight of the event. You only pay for people who actually join — nothing upfront.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.flame.opacity(0.08)))

                // Card-on-file requirement.
                if let b = model.billing, b.cardVerified {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.gold).font(.system(size: 13))
                        Text("\(b.cardBrand?.capitalized ?? "Card") ending \(b.cardLast4 ?? "••••") on file")
                            .font(.cfSans(12)).foregroundStyle(Theme.parchment)
                    }
                } else {
                    Button {
                        Task {
                            model.checkingCard = true
                            if let url = try? await model.repo.billingSetupURL() { openURL(url) }
                            model.checkingCard = false
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if model.checkingCard { ProgressView().tint(Theme.parchment).scaleEffect(0.8) }
                            else { Image(systemName: "creditcard") }
                            Text("Add a payment method to enable")
                                .font(.cfSans(13, weight: .medium))
                        }
                        .foregroundStyle(Theme.parchment)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusPill).stroke(Theme.parchmentFaint))
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private var autoCheckinCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker("Auto check-in")
            Toggle(isOn: $model.autoCheckin.animation()) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Auto check-in guests by location")
                        .font(.cfSans(14, weight: .medium))
                        .foregroundStyle(Theme.parchment)
                    Text(model.autoCheckin
                         ? "Guests are marked arrived automatically when they reach the pin."
                         : "Guests must be checked in manually at the door.")
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            .tint(Theme.ember)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
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
                    Text(model.setOpenClose
                         ? "What time the night runs."
                         : "Off — we assume 10 PM to 4 AM for auto check-in timing.")
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
            HStack {
                Kicker("Spots")
                Spacer()
                Button {
                    Haptics.tap()
                    withAnimation { model.unlimitedSpots.toggle() }
                } label: {
                    Text("Unlimited")
                        .font(.cfMono(9, weight: .medium)).kerning(1.2)
                        .foregroundStyle(model.unlimitedSpots ? Theme.emberCream : Theme.parchmentDim)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(model.unlimitedSpots ? Theme.ember : Color.clear))
                        .overlay(Capsule().stroke(model.unlimitedSpots ? Color.clear : Theme.parchmentFaint))
                }
            }
            Text("How many guests can you bring per night?")
                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            if model.unlimitedSpots {
                HStack {
                    Text("∞").font(.cfSerif(34)).foregroundStyle(Theme.ember)
                    Text("No cap on this guestlist")
                        .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                    Spacer()
                }
                .padding(.vertical, 4)
            } else {
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
