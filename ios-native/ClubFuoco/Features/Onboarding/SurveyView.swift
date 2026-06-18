import SwiftUI

/// Native port of the web `/onboarding` preferences survey — a 7-step
/// questionnaire (music · vibes · drinks · nights · budget · squad · crowd)
/// that saves to `POST /api/preferences` and then finishes onboarding.
/// Strings mirror the web page, which hardcodes them (they are not in the
/// localization table), so they're hardcoded here too.
struct SurveyView: View {
    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale

    /// Called when the survey is done (saved or skipped through) — the host
    /// finishes onboarding and drops the user into the app.
    let onComplete: () -> Void
    /// Called when the user backs out of the first step.
    let onCancel: () -> Void

    @State private var step = 0
    @State private var saving = false
    @State private var prefs = Prefs()

    private var current: SurveyStep { Self.steps[step] }
    private var isLast: Bool { step == Self.steps.count - 1 }

    /// Merge static genre options with anything the user typed in, so custom
    /// additions appear as toggleable chips instead of vanishing into state.
    private var musicOptionsWithCustom: [Opt] {
        let presetValues = Set(Self.music.map(\.value))
        let extras = prefs.music.filter { !presetValues.contains($0) }
            .map { Opt(value: $0, label: $0) }
        return Self.music + extras
    }
    private var vibesOptionsWithCustom: [Opt] {
        let presetValues = Set(Self.vibes.map(\.value))
        let extras = prefs.vibes.filter { !presetValues.contains($0) }
            .map { Opt(value: $0, label: $0) }
        return Self.vibes + extras
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                SegmentedProgress(step: step + 1, total: Self.steps.count)
                    .padding(.bottom, 24)

                Kicker(current.kicker)
                    .padding(.bottom, 12)

                (Text(current.title) + Text("\n") + Text(current.italic).italic())
                    .font(.cfSerif(46))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 6)

                (Text(current.sub) + (current.key == .vibes
                    ? Text("  · \(prefs.vibes.count)/3").foregroundColor(Theme.sand)
                    : Text("")))
                    .font(.cfSans(13.5))
                    .foregroundStyle(Theme.stone)
                    .padding(.bottom, 28)

                stepBody
                    .padding(.bottom, 28)

                ctaButtons
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .background(Theme.cream)
        .scrollDismissesKeyboard(.interactively)
        .toolbar(.hidden, for: .navigationBar)
    }

    // ── Header ────────────────────────────────────────────────────────────────

    private var header: some View {
        HStack {
            BackChevronButton { back() }
            Spacer()
            Text(String(format: "%02d / %02d", step + 1, Self.steps.count))
                .font(.cfMono(8.5))
                .kerning(1.9)
                .foregroundStyle(Theme.fadedSand)
        }
        .padding(.bottom, 12)
    }

    // ── Step body ───────────────────────────────────────────────────────────────

    @ViewBuilder private var stepBody: some View {
        switch current.key {
        case .music:
            VStack(alignment: .leading, spacing: 18) {
                FlowChips(options: musicOptionsWithCustom, isSelected: isSelected) { toggle($0) }
                CustomItemEntry(
                    placeholder: "Add another genre…",
                    canAdd: { !prefs.music.contains($0) }
                ) { value in
                    prefs.music.append(value)
                }
            }
        case .vibes:
            VStack(alignment: .leading, spacing: 18) {
                FlowChips(options: vibesOptionsWithCustom, isSelected: isSelected) { toggle($0) }
                CustomItemEntry(
                    placeholder: "Add another vibe…",
                    canAdd: { !prefs.vibes.contains($0) && prefs.vibes.count < 3 }
                ) { value in
                    prefs.vibes.append(value)
                }
            }
        case .drinks:
            DrinksAccordion(drinks: $prefs.drinks)
        case .budget:
            BudgetSlider(budget: $prefs.budget)
        case .squad:
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(Self.squad, id: \.value) { opt in
                    SquadCard(label: opt.label, sub: opt.sub, selected: prefs.squad == opt.value) {
                        Haptics.tap(); prefs.squad = opt.value
                    }
                }
            }
        default:
            FlowChips(options: current.options, isSelected: isSelected) { value in
                toggle(value)
            }
        }
    }

    private var ctaButtons: some View {
        VStack(spacing: 12) {
            PrimaryButton(
                title: isLast ? "Let's go" : "Continue",
                loading: saving,
                disabled: !canAdvance
            ) { advance() }

            Button {
                Haptics.tap(); advance(skip: true)
            } label: {
                Text("Skip for now")
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.sand)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
        }
    }

    // ── Selection logic ─────────────────────────────────────────────────────────

    private func isSelected(_ value: String) -> Bool {
        switch current.key {
        case .music:  return prefs.music.contains(value)
        case .vibes:  return prefs.vibes.contains(value)
        case .drinks: return prefs.drinks.contains(value)
        case .nights: return prefs.nights.contains(value)
        case .crowd:  return prefs.crowd == value
        default:      return false
        }
    }

    private func toggle(_ value: String) {
        Haptics.tap()
        switch current.key {
        case .music:  prefs.music = toggled(prefs.music, value)
        case .vibes:
            let next = toggled(prefs.vibes, value)
            if next.count <= 3 { prefs.vibes = next }   // cap at 3
        case .drinks: prefs.drinks = toggled(prefs.drinks, value)
        case .nights: prefs.nights = toggled(prefs.nights, value)
        case .crowd:  prefs.crowd = value               // single-select
        default:      break
        }
    }

    private func toggled(_ arr: [String], _ value: String) -> [String] {
        arr.contains(value) ? arr.filter { $0 != value } : arr + [value]
    }

    private var canAdvance: Bool {
        switch current.key {
        case .music:  return !prefs.music.isEmpty
        case .vibes:  return !prefs.vibes.isEmpty
        case .drinks: return !prefs.drinks.isEmpty
        case .nights: return !prefs.nights.isEmpty
        case .budget: return true
        case .squad:  return !prefs.squad.isEmpty
        case .crowd:  return !prefs.crowd.isEmpty
        }
    }

    // ── Navigation ──────────────────────────────────────────────────────────────

    private func back() {
        if step == 0 { onCancel() } else { withAnimation { step -= 1 } }
    }

    private func advance(skip: Bool = false) {
        if isLast { finish() }
        else { withAnimation { step += 1 } }
    }

    private func finish() {
        guard !saving else { return }
        saving = true
        let payload = prefs
        let client = api
        Task {
            // Best-effort save — never block the user out of the app on failure.
            let _: SavedResult? = try? await client.post("/api/preferences", body: payload)
            await MainActor.run { onComplete() }
        }
    }

    // ── Data ──────────────────────────────────────────────────────────────────

    struct Prefs: Encodable {
        var music: [String] = []
        var vibes: [String] = []
        var drinks: [String] = []
        var nights: [String] = []
        var budget: Int = 50
        var squad: String = ""
        var crowd: String = ""
    }

    struct SavedResult: Decodable, Sendable { let saved: Bool? }

    enum StepKey { case music, vibes, drinks, nights, budget, squad, crowd }

    struct SurveyStep {
        let key: StepKey
        let kicker: String
        let title: String
        let italic: String
        let sub: String
        let options: [Opt]
    }

    struct Opt: Hashable { let value: String; let label: String; var sub: String = "" }

    static let steps: [SurveyStep] = [
        .init(key: .music,  kicker: "N° 01 · Musica",    title: "What gets you",    italic: "moving?", sub: "Pick all the genres you love.", options: music),
        .init(key: .vibes,  kicker: "N° 02 · Atmosfera", title: "What's your",      italic: "vibe?",   sub: "Pick up to 3 that fit you best.", options: vibes),
        .init(key: .drinks, kicker: "N° 03 · Bevande",   title: "What's in your",   italic: "glass?",  sub: "Pick everything you drink.", options: []),
        .init(key: .nights, kicker: "N° 04 · Serate",    title: "When do you come", italic: "alive?",  sub: "Pick every night you go out.", options: nights),
        .init(key: .budget, kicker: "N° 05 · Budget",    title: "What's your",      italic: "limit?",  sub: "How much do you spend on a night out?", options: []),
        .init(key: .squad,  kicker: "N° 06 · Compagnia", title: "Who do you roll",  italic: "with?",   sub: "How big is the crew you go out with.", options: []),
        .init(key: .crowd,  kicker: "N° 07 · Folla",     title: "Who's your",       italic: "crowd?",  sub: "The kind of people around you.", options: crowd),
    ]

    static let music: [Opt] = ["House","Techno","Hip-Hop","R&B","Latin","Reggaeton","Afrobeats","Electronic","Drum & Bass","Commercial","Live Music","Jazz"].map { .init(value: $0, label: $0) }
    static let vibes: [Opt] = [
        .init(value: "wild", label: "Wild & loud"), .init(value: "intimate", label: "Intimate"),
        .init(value: "underground", label: "Underground"), .init(value: "upscale", label: "Upscale"),
        .init(value: "rooftop", label: "Rooftop"), .init(value: "beach", label: "Beachfront"),
        .init(value: "dancing", label: "Dance floor"), .init(value: "chill", label: "Chill bar"),
    ]
    static let nights: [Opt] = [
        .init(value: "thursday", label: "Thursday"), .init(value: "friday", label: "Friday"),
        .init(value: "saturday", label: "Saturday"), .init(value: "sunday", label: "Sunday"),
        .init(value: "wednesday", label: "Wednesday"), .init(value: "monday", label: "Monday"),
        .init(value: "tuesday", label: "Tuesday"), .init(value: "special", label: "Special occasions"),
    ]
    static let crowd: [Opt] = [
        .init(value: "mixed", label: "Mixed crowd"), .init(value: "lgbtq", label: "LGBTQ+ friendly"),
        .init(value: "local", label: "Mostly locals"), .init(value: "international", label: "International"),
        .init(value: "mature", label: "Mature (25+)"), .init(value: "young", label: "Young energy"),
        .init(value: "students", label: "Students"), .init(value: "industry", label: "Industry / creatives"),
        .init(value: "tourists", label: "Tourists & travelers"), .init(value: "wealthy", label: "Bottle service"),
    ]
    static let squad: [Opt] = [
        .init(value: "solo", label: "Solo", sub: "Just me"), .init(value: "duo", label: "Duo", sub: "Me + 1"),
        .init(value: "small", label: "Crew", sub: "3 – 5"), .init(value: "large", label: "Gang", sub: "6+"),
    ]
}

// ── Building blocks ─────────────────────────────────────────────────────────────

/// Wrapping chip grid for multi/single select option steps.
private struct FlowChips: View {
    let options: [SurveyView.Opt]
    let isSelected: (String) -> Bool
    let onTap: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 10) {
            ForEach(options, id: \.value) { opt in
                let selected = isSelected(opt.value)
                Button { onTap(opt.value) } label: {
                    Text(opt.label)
                        .font(.cfSans(14, weight: selected ? .medium : .regular))
                        .foregroundStyle(selected ? Theme.cream : Theme.ink)
                        .padding(.horizontal, 16)
                        .frame(height: 42)
                        .background(selected ? Theme.wine : Color.white, in: .capsule)
                        .overlay(Capsule().stroke(selected ? Color.clear : Theme.hairline))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Free-text entry for adding a custom genre/vibe — keyboard returns to "Done"
/// and dismisses via FocusState on submit so the screen doesn't get stuck.
private struct CustomItemEntry: View {
    let placeholder: String
    let canAdd: (String) -> Bool
    let onAdd: (String) -> Void

    @State private var text: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            TextField(placeholder, text: $text)
                .focused($focused)
                .submitLabel(.done)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled(false)
                .onSubmit(submit)
                .font(.cfSans(14))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 16)
                .frame(height: 42)
                .background(Color.white, in: .capsule)
                .overlay(Capsule().stroke(Theme.hairline))

            Button(action: submit) {
                Text("Add")
                    .font(.cfSans(13, weight: .medium))
                    .foregroundStyle(canSubmit ? Theme.cream : Theme.sand)
                    .padding(.horizontal, 18)
                    .frame(height: 42)
                    .background(canSubmit ? Theme.wine : Color.white, in: .capsule)
                    .overlay(Capsule().stroke(canSubmit ? Color.clear : Theme.hairline))
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)
        }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSubmit: Bool { !trimmed.isEmpty && canAdd(trimmed) }

    private func submit() {
        let value = trimmed
        guard !value.isEmpty, canAdd(value) else {
            focused = false
            return
        }
        Haptics.tap()
        onAdd(value)
        text = ""
        focused = false
    }
}

private struct SquadCard: View {
    let label: String
    let sub: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.cfSerif(24, italic: true))
                    .foregroundStyle(selected ? Theme.cream : Theme.ink)
                Text(sub)
                    .font(.cfSans(11))
                    .foregroundStyle(selected ? Theme.cream.opacity(0.8) : Theme.stone)
            }
            .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
            .padding(16)
            .background(selected ? Theme.wine : Color.white, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(selected ? Color.clear : Theme.hairline))
        }
        .buttonStyle(.plain)
    }
}

private struct BudgetSlider: View {
    @Binding var budget: Int
    private let presets = [20, 50, 100, 150, 200]
    private let noLimit = 999

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(budget >= noLimit ? "No limit" : "€\(budget)")
                .font(.cfSerif(40))
                .foregroundStyle(Theme.ink)

            if budget < noLimit {
                Slider(
                    value: Binding(
                        get: { Double(min(budget, 250)) },
                        set: { budget = Int(($0 / 5).rounded()) * 5 }
                    ),
                    in: 10...250, step: 5
                )
                .tint(Theme.wine)
            }

            VStack(spacing: 10) {
                HStack(spacing: 6) {
                    ForEach(presets, id: \.self) { v in
                        chip("€\(v)", selected: budget == v, fillWidth: true) { budget = v }
                    }
                }
                HStack {
                    Spacer()
                    chip("No limit", selected: budget >= noLimit) { budget = noLimit }
                    Spacer()
                }
            }
        }
    }

    private func chip(_ label: String, selected: Bool, fillWidth: Bool = false, action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            Text(label)
                .font(.cfSans(13, weight: selected ? .medium : .regular))
                .foregroundStyle(selected ? Theme.cream : Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.horizontal, fillWidth ? 6 : 16)
                .frame(maxWidth: fillWidth ? .infinity : nil)
                .frame(height: 38)
                .background(selected ? Theme.wine : Color.white, in: .capsule)
                .overlay(Capsule().stroke(selected ? Color.clear : Theme.hairline))
        }
        .buttonStyle(.plain)
    }
}

// ── Drinks accordion — mirrors web `DrinkStep` ─────────────────────────────────
// Category list is shared with the review survey via DrinkCategories.swift.

private let ALL_PRESET_DRINK_ITEMS: Set<String> = {
    var s = Set<String>()
    for c in DRINK_CATEGORIES {
        s.formUnion(c.items)
        s.insert(c.key)
    }
    return s
}()

private struct DrinksAccordion: View {
    @Binding var drinks: [String]
    @State private var expanded: String? = nil
    @State private var customInputs: [String: String] = [:]
    @FocusState private var focusedKey: String?

    var body: some View {
        VStack(spacing: 10) {
            ForEach(DRINK_CATEGORIES, id: \.key) { cat in
                DrinkCategoryCard(
                    cat: cat,
                    expanded: expanded == cat.key,
                    drinks: $drinks,
                    customInput: Binding(
                        get: { customInputs[cat.key] ?? "" },
                        set: { customInputs[cat.key] = $0 }
                    ),
                    focusedKey: $focusedKey,
                    onToggleExpand: {
                        Haptics.tap()
                        withAnimation(.easeInOut(duration: 0.18)) {
                            expanded = expanded == cat.key ? nil : cat.key
                        }
                        // Close keyboard from a sibling input when switching cards.
                        if focusedKey != cat.key { focusedKey = nil }
                    }
                )
            }
        }
    }
}

private struct DrinkCategoryCard: View {
    let cat: DrinkCategory
    let expanded: Bool
    @Binding var drinks: [String]
    @Binding var customInput: String
    var focusedKey: FocusState<String?>.Binding
    let onToggleExpand: () -> Void

    /// Custom items typed by the user in this category card during this session.
    /// We can't tell after the fact which category a custom drink belongs to,
    /// so each card remembers its own additions.
    @State private var customAdditions: [String] = []

    private var customItems: [String] {
        if cat.key == "other" {
            return drinks.filter { !ALL_PRESET_DRINK_ITEMS.contains($0) }
        }
        return customAdditions
    }
    private var hasSelection: Bool {
        if cat.key == "other" { return !customItems.isEmpty }
        return cat.items.contains(where: { drinks.contains($0) })
            || drinks.contains(cat.key)
            || customAdditions.contains(where: { drinks.contains($0) })
    }
    private var isDontCare: Bool { drinks.contains(cat.key) }
    private var selCount: Int {
        if cat.key == "other" { return customItems.count }
        let preset = cat.items.filter { drinks.contains($0) }.count
        let extra = customAdditions.filter { drinks.contains($0) }.count
        return preset + extra
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            Button(action: onToggleExpand) {
                HStack(spacing: 8) {
                    if hasSelection {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.wine)
                    }
                    Text(cat.label)
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(hasSelection ? Theme.ink : Theme.stone)
                    if isDontCare {
                        Text("ANY")
                            .font(.cfMono(8.5))
                            .kerning(1.6)
                            .foregroundStyle(Theme.sand)
                    } else if selCount > 0 {
                        Text("\(selCount) SELECTED")
                            .font(.cfMono(8.5))
                            .kerning(1.6)
                            .foregroundStyle(Theme.wine.opacity(0.7))
                    }
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.sand)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(hasSelection ? Theme.wine.opacity(0.06) : Color.white)
            }
            .buttonStyle(.plain)

            if expanded {
                VStack(alignment: .leading, spacing: 12) {
                    if !cat.items.isEmpty {
                        FlowLayout(spacing: 8) {
                            ForEach(cat.items, id: \.self) { item in
                                drinkPill(item)
                            }
                        }
                    }

                    if !customItems.isEmpty {
                        FlowLayout(spacing: 8) {
                            ForEach(customItems, id: \.self) { item in
                                drinkPill(item)
                            }
                        }
                    }

                    // Custom entry — always allowed.
                    HStack(spacing: 8) {
                        TextField(cat.key == "other" ? "Type anything you like…" : "Add your own…",
                                  text: $customInput)
                            .focused(focusedKey, equals: cat.key)
                            .submitLabel(.done)
                            .textInputAutocapitalization(.words)
                            .onSubmit { addCustom() }
                            .font(.cfSans(13))
                            .foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .background(Color.white, in: .capsule)
                            .overlay(Capsule().stroke(Theme.hairline))

                        Button(action: addCustom) {
                            Text("Add")
                                .font(.cfSans(12, weight: .medium))
                                .foregroundStyle(canAddCustom ? Theme.cream : Theme.sand)
                                .padding(.horizontal, 14)
                                .frame(height: 38)
                                .background(canAddCustom ? Theme.wine : Color.white, in: .capsule)
                                .overlay(Capsule().stroke(canAddCustom ? Color.clear : Theme.hairline))
                        }
                        .buttonStyle(.plain)
                        .disabled(!canAddCustom)
                    }

                    if cat.key != "other" {
                        Button(action: dontCare) {
                            Text("I don't really care")
                                .font(.cfMono(9))
                                .kerning(1.6)
                                .foregroundStyle(isDontCare ? Theme.wine : Theme.sand)
                                .frame(maxWidth: .infinity)
                                .frame(height: 36)
                                .background(isDontCare ? Theme.wine.opacity(0.08) : Color.clear, in: .capsule)
                                .overlay(Capsule().stroke(isDontCare ? Theme.wine.opacity(0.4) : Theme.hairline))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(14)
                .background(Color.white.opacity(0.6))
            }
        }
        .background(Color.white, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16)
            .stroke(hasSelection ? Theme.wine : Theme.hairline,
                    lineWidth: hasSelection ? 1.5 : 1))
        .clipShape(.rect(cornerRadius: 16))
    }

    private func drinkPill(_ item: String) -> some View {
        let selected = drinks.contains(item)
        return Button {
            Haptics.tap()
            if selected { drinks.removeAll { $0 == item } }
            else { drinks.append(item) }
        } label: {
            HStack(spacing: 5) {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.cream)
                }
                Text(item)
                    .font(.cfSans(12, weight: selected ? .medium : .regular))
                    .foregroundStyle(selected ? Theme.cream : Theme.ink)
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(selected ? Theme.wine : Color.white, in: .capsule)
            .overlay(Capsule().stroke(selected ? Color.clear : Theme.hairline))
        }
        .buttonStyle(.plain)
    }

    private var trimmed: String { customInput.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canAddCustom: Bool { !trimmed.isEmpty && !drinks.contains(trimmed) }

    private func addCustom() {
        let value = trimmed
        guard !value.isEmpty else { focusedKey.wrappedValue = nil; return }
        if !drinks.contains(value) {
            Haptics.tap()
            drinks.append(value)
        }
        if cat.key != "other", !customAdditions.contains(value) {
            customAdditions.append(value)
        }
        customInput = ""
        focusedKey.wrappedValue = nil
    }

    private func dontCare() {
        Haptics.tap()
        drinks.removeAll { cat.items.contains($0) || $0 == cat.key }
        drinks.append(cat.key)
    }
}
