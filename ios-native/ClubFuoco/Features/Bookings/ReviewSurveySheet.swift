import SwiftUI

/// Native port of the web `<SurveySheet>` — the morning-after review flow.
///
/// Pre-gate: "Did you go?" — picking "I didn't go" posts `post_entry_issue`
/// with reason `did_not_go` and closes the sheet, no further questions.
///
/// Survey: 5 steps mirroring the web — overall rating, drinks, music + vibe,
/// crowd, would-return — then POSTs `/api/surveys`. Required-only payload;
/// per-drink star ratings + custom-text-per-category from the web version are
/// intentionally skipped for the MVP since the API treats them as optional.
struct ReviewSurveySheet: View {
    let booking: Booking
    /// Fires after a successful submit OR an "I didn't go" answer — both end
    /// states where the parent should drop this booking from pending reviews.
    var onSubmitted: (UUID) -> Void = { _ in }
    var onDismiss: () -> Void = {}

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss

    private enum Phase: Int, CaseIterable { case didYouGo, rating, drinks, drinkRatings, music, crowd, wouldReturn }
    @State private var phase: Phase = .didYouGo

    @State private var rating: Int = 0
    /// Per-category specific drinks picked (e.g. cocktails → ["Negroni","Mojito"]).
    @State private var drinkPicks: [String: Set<String>] = [:]
    /// Per-category free-text additions (e.g. "their house signature").
    @State private var drinkCustom: [String: String] = [:]
    /// 1–5 star rating per individual drink — populated on the drinkRatings step.
    @State private var drinkRatings: [String: Int] = [:]
    @State private var musicRating: Int = 0
    @State private var musicGenres: Set<String> = []
    @State private var crowdRating: Int = 0
    @State private var wouldReturn: String? = nil    // "yes" | "maybe" | "no"

    /// Flat list of every drink the user picked (preset chips + custom text)
    /// across all categories, used by the per-drink ratings step.
    private var allDrinks: [String] {
        var out: [String] = []
        for cat in DRINK_CATEGORIES {
            out.append(contentsOf: (drinkPicks[cat.key] ?? []).sorted())
            let extra = (drinkCustom[cat.key] ?? "").trimmingCharacters(in: .whitespaces)
            if !extra.isEmpty { out.append(extra) }
        }
        return out
    }

    /// Categories with at least one pick or custom entry — what the API stores
    /// in `drinks: string[]`.
    private var selectedCategories: [String] {
        DRINK_CATEGORIES.compactMap { cat in
            let pickCount   = drinkPicks[cat.key]?.count ?? 0
            let customCount = (drinkCustom[cat.key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty ? 0 : 1
            return (pickCount + customCount) > 0 ? cat.key : nil
        }
    }

    @State private var submitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    body(for: phase)
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.cfSans(12))
                            .foregroundStyle(Theme.wine)
                    }
                    Spacer(minLength: 12)
                    footerActions
                }
                .padding(24)
            }
            .background(Theme.cream)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { close() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.stone)
                    }
                }
            }
        }
    }

    // ── Header ────────────────────────────────────────────────────────────────

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("N° \(String(format: "%02d", phase.rawValue + 1)) · REVIEW")
                .font(.cfMono(9))
                .kerning(1.8)
                .foregroundStyle(Theme.wine.opacity(0.7))
            (Text(headerTitle) + Text("\n") + Text(headerItalic).italic())
                .font(.cfSerif(34))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(headerSub)
                .font(.cfSans(13))
                .foregroundStyle(Theme.stone)
            HStack(spacing: 4) {
                ForEach(Phase.allCases, id: \.self) { p in
                    Capsule()
                        .fill(p.rawValue <= phase.rawValue ? Theme.wine : Theme.hairline)
                        .frame(height: 2)
                }
            }
            .padding(.top, 8)
        }
    }

    private var headerTitle: String {
        switch phase {
        case .didYouGo:     "Did you make it"
        case .rating:       "Overall, how"
        case .drinks:       "What did"
        case .drinkRatings: "Rate every"
        case .music:        "Music + the"
        case .crowd:        "And the"
        case .wouldReturn:  "Would you go"
        }
    }
    private var headerItalic: String {
        switch phase {
        case .didYouGo:     "to \(booking.club?.name ?? "the venue")?"
        case .rating:       "was the night?"
        case .drinks:       "you drink?"
        case .drinkRatings: "drink."
        case .music:        "vibe."
        case .crowd:        "crowd."
        case .wouldReturn:  "back?"
        }
    }
    private var headerSub: String {
        switch phase {
        case .didYouGo:     "Quick check before the review — answer honestly, it only takes a second."
        case .rating:       "A general feel for the night."
        case .drinks:       "Pick everything you ordered. Helps us learn what each club does well."
        case .drinkRatings: "Tap stars for each — that's how we figure out which club does which drink best."
        case .music:        "Tap a vibe rating + the genres you actually heard."
        case .crowd:        "How was the room?"
        case .wouldReturn:  "Last one — would you book it again?"
        }
    }

    // ── Per-phase body ────────────────────────────────────────────────────────

    @ViewBuilder private func body(for phase: Phase) -> some View {
        switch phase {
        case .didYouGo:
            VStack(spacing: 10) {
                bigChoice(label: "Yes, I went", systemImage: "checkmark.circle.fill") {
                    // Record the attendance claim immediately, so it sticks even
                    // if they abandon the rest of the review.
                    recordWentIn()
                    advance(from: .didYouGo)
                }
                bigChoice(label: "I didn't go", systemImage: "xmark.circle") {
                    Task { await sendDidNotGo() }
                }
            }
        case .rating:
            StarRow(selection: $rating)
        case .drinks:
            ReviewDrinkAccordion(picks: $drinkPicks, custom: $drinkCustom)
        case .drinkRatings:
            VStack(alignment: .leading, spacing: 12) {
                ForEach(allDrinks, id: \.self) { drink in
                    VStack(alignment: .leading, spacing: 14) {
                        Text(drink)
                            .font(.cfSerif(18, italic: true))
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        CompactStarRow(
                            selection: Binding(
                                get: { drinkRatings[drink] ?? 0 },
                                set: { drinkRatings[drink] = $0 }
                            )
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(16)
                    .background(Theme.surface, in: .rect(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14)
                        .stroke((drinkRatings[drink] ?? 0) > 0 ? Theme.wine.opacity(0.4) : Theme.hairline))
                }
            }
        case .music:
            VStack(alignment: .leading, spacing: 18) {
                Text("HOW WAS IT?")
                    .font(.cfMono(9)).kerning(1.6).foregroundStyle(Theme.fadedSand)
                StarRow(selection: $musicRating)
                Text("WHAT WAS PLAYING?")
                    .font(.cfMono(9)).kerning(1.6).foregroundStyle(Theme.fadedSand)
                    .padding(.top, 4)
                FlowChips(values: ReviewSurveySheet.musicGenres, selected: musicGenres) { value in
                    if musicGenres.contains(value) { musicGenres.remove(value) }
                    else { musicGenres.insert(value) }
                }
            }
        case .crowd:
            StarRow(selection: $crowdRating)
        case .wouldReturn:
            VStack(spacing: 10) {
                returnChip("Yes — book it again",          value: "yes")
                returnChip("Maybe — depends on the night", value: "maybe")
                returnChip("No",                           value: "no")
            }
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private var footerActions: some View {
        Group {
            if phase != .didYouGo {
                PrimaryButton(
                    title: phase == .wouldReturn ? "Submit review" : "Continue",
                    loading: submitting,
                    disabled: !canAdvance
                ) {
                    if phase == .wouldReturn { Task { await submit() } }
                    else { advance(from: phase) }
                }
                Button("Cancel") { close() }
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.sand)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            }
        }
    }

    private var canAdvance: Bool {
        switch phase {
        case .didYouGo:     true
        case .rating:       rating > 0
        case .drinks:       !selectedCategories.isEmpty
        case .drinkRatings: allDrinks.allSatisfy { (drinkRatings[$0] ?? 0) > 0 }
        case .music:        musicRating > 0 && !musicGenres.isEmpty
        case .crowd:        crowdRating > 0
        case .wouldReturn:  wouldReturn != nil
        }
    }

    private func advance(from current: Phase) {
        Haptics.tap()
        guard let next = Phase(rawValue: current.rawValue + 1) else { return }
        withAnimation { phase = next }
    }

    /// Fire the "I got in" attendance signal (→ user_claimed_attended) the
    /// moment they confirm they went, independent of finishing the review.
    /// Fire-and-forget; a failure just leaves attendance for the geo signals.
    private func recordWentIn() {
        let path = "/api/bookings/\(booking.id.uuidString.lowercased())/signals"
        struct SBody: Encodable { let kind: String }
        struct SResp: Decodable, Sendable { let attendanceStatus: String? }
        Task { let _: SResp? = try? await api.post(path, body: SBody(kind: "post_entry_got_in")) }
    }

    private func sendDidNotGo() async {
        guard !submitting else { return }
        submitting = true; defer { submitting = false }
        struct Body: Encodable { let kind: String; let reason: String }
        struct Resp: Decodable, Sendable { let logged: String? }
        let path = "/api/bookings/\(booking.id.uuidString.lowercased())/signals"
        do {
            let _: Resp = try await api.post(path, body: Body(kind: "post_entry_issue", reason: "did_not_go"))
            Haptics.success()
            onSubmitted(booking.id)
            close()
        } catch {
            Haptics.error()
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't save that. Try again."
        }
    }

    private func submit() async {
        guard !submitting,
              rating > 0, !selectedCategories.isEmpty,
              musicRating > 0, !musicGenres.isEmpty,
              crowdRating > 0, let wouldReturn else { return }
        submitting = true; defer { submitting = false }

        struct Payload: Encodable {
            let bookingId: String
            let rating: Int
            let drinks: [String]
            /// `drink_kinds`: per-category specific drinks chosen.
            let drinkKinds: [String: [String]]
            /// `drink_custom`: per-category free-text additions.
            let drinkCustom: [String: String]
            /// `drink_ratings`: per-drink 1-5 stars.
            let drinkRatings: [String: Int]
            let vibeRating: Int
            let crowdRating: Int
            let wouldReturn: String
            let musicGenres: [String]
        }
        struct Resp: Decodable, Sendable { let saved: Bool? }

        // Flatten the picks into the {category: [items]} shape the API expects,
        // dropping categories with no selection.
        let kinds = Dictionary(uniqueKeysWithValues:
            drinkPicks.compactMap { (k, v) -> (String, [String])? in
                v.isEmpty ? nil : (k, Array(v).sorted())
            }
        )
        let trimmedCustom = drinkCustom
            .mapValues { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.value.isEmpty }

        let ratingsOnly = drinkRatings.filter { allDrinks.contains($0.key) && $0.value > 0 }
        let payload = Payload(
            bookingId: booking.id.uuidString.lowercased(),
            rating: rating,
            drinks: selectedCategories,
            drinkKinds: kinds,
            drinkCustom: trimmedCustom,
            drinkRatings: ratingsOnly,
            vibeRating: musicRating,
            crowdRating: crowdRating,
            wouldReturn: wouldReturn,
            musicGenres: Array(musicGenres)
        )

        do {
            let _: Resp = try await api.post("/api/surveys", body: payload)
            // Mirror the web flow — a completed review is itself confirmation
            // they got in, so attendance picks it up as `user_claimed_attended`.
            // Best-effort: even if the signal is rejected (e.g. older booking
            // outside the post-entry window), the survey row was saved.
            let signalPath = "/api/bookings/\(booking.id.uuidString.lowercased())/signals"
            struct SBody: Encodable { let kind: String }
            let _: Resp? = try? await api.post(signalPath, body: SBody(kind: "post_entry_got_in"))
            Haptics.success()
            onSubmitted(booking.id)
            close()
        } catch {
            Haptics.error()
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't submit. Try again."
        }
    }

    private func close() {
        dismiss()
        onDismiss()
    }

    // ── Sub-views ─────────────────────────────────────────────────────────────

    private func bigChoice(label: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage).font(.system(size: 16, weight: .semibold))
                Text(label).font(.cfSans(15, weight: .semibold))
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.sand)
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 18)
            .frame(height: 60)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: .rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
        }
        .buttonStyle(.plain)
    }

    private func returnChip(_ label: String, value: String) -> some View {
        let selected = wouldReturn == value
        return Button { Haptics.tap(); wouldReturn = value } label: {
            HStack {
                if selected {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 14, weight: .semibold))
                }
                Text(label).font(.cfSans(14, weight: selected ? .semibold : .regular))
                Spacer()
            }
            .foregroundStyle(selected ? Theme.cream : Theme.ink)
            .padding(.horizontal, 18)
            .frame(height: 52)
            .frame(maxWidth: .infinity)
            .background(selected ? Theme.wine : Theme.surface, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .stroke(selected ? Color.clear : Theme.hairline))
        }
        .buttonStyle(.plain)
    }

    // ── Static option lists (mirror onboarding survey for consistency) ───────

    static let drinkCategoryLabels: [String] = [
        "Cocktails","Beer","Wine","Shots","Champagne","Non-alcoholic","Other",
    ]
    static let musicGenres: [String] = [
        "House","Techno","Hip-Hop","R&B","Latin","Reggaeton","Afrobeats",
        "Electronic","Drum & Bass","Commercial","Live Music","Jazz",
    ]
}

// MARK: - Helpers shared by the review sheet

private struct StarRow: View {
    @Binding var selection: Int
    var body: some View {
        HStack(spacing: 8) {
            ForEach(1...5, id: \.self) { v in
                Button {
                    Haptics.tap()
                    selection = (selection == v) ? 0 : v
                } label: {
                    Image(systemName: v <= selection ? "star.fill" : "star")
                        .font(.system(size: 32))
                        .foregroundStyle(v <= selection ? Theme.wine : Theme.fadedSand)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct CompactStarRow: View {
    @Binding var selection: Int
    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...5, id: \.self) { v in
                Button {
                    Haptics.tap()
                    selection = (selection == v) ? 0 : v
                } label: {
                    Image(systemName: v <= selection ? "star.fill" : "star")
                        .font(.system(size: 26))
                        .foregroundStyle(v <= selection ? Theme.wine : Theme.fadedSand)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct FlowChips: View {
    let values: [String]
    let selected: Set<String>
    let onTap: (String) -> Void
    var body: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(values, id: \.self) { v in
                let on = selected.contains(v)
                Button { onTap(v) } label: {
                    Text(v)
                        .font(.cfSans(13, weight: on ? .semibold : .regular))
                        .foregroundStyle(on ? Theme.cream : Theme.ink)
                        .padding(.horizontal, 14)
                        .frame(height: 38)
                        .background(on ? Theme.wine : Theme.surface, in: .capsule)
                        .overlay(Capsule().stroke(on ? Color.clear : Theme.hairline))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// ── Per-category accordion for review drinks ───────────────────────────────────

private struct ReviewDrinkAccordion: View {
    @Binding var picks:  [String: Set<String>]
    @Binding var custom: [String: String]

    @State private var expanded: String? = nil
    @FocusState private var focusedKey: String?

    var body: some View {
        VStack(spacing: 10) {
            ForEach(DRINK_CATEGORIES, id: \.key) { cat in
                CategoryCard(
                    cat: cat,
                    expanded: expanded == cat.key,
                    picks: pickBinding(for: cat.key),
                    custom: customBinding(for: cat.key),
                    focusedKey: $focusedKey,
                    onToggle: {
                        Haptics.tap()
                        withAnimation(.easeInOut(duration: 0.18)) {
                            expanded = expanded == cat.key ? nil : cat.key
                        }
                        if focusedKey != cat.key { focusedKey = nil }
                    }
                )
            }
        }
    }

    private func pickBinding(for key: String) -> Binding<Set<String>> {
        Binding(
            get: { picks[key] ?? [] },
            set: { picks[key] = $0 }
        )
    }
    private func customBinding(for key: String) -> Binding<String> {
        Binding(
            get: { custom[key] ?? "" },
            set: { custom[key] = $0 }
        )
    }

    private struct CategoryCard: View {
        let cat: DrinkCategory
        let expanded: Bool
        @Binding var picks: Set<String>
        @Binding var custom: String
        var focusedKey: FocusState<String?>.Binding
        let onToggle: () -> Void

        private var hasSelection: Bool {
            !picks.isEmpty || !custom.trimmingCharacters(in: .whitespaces).isEmpty
        }
        private var count: Int {
            picks.count + (custom.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : 1)
        }

        var body: some View {
            VStack(spacing: 0) {
                Button(action: onToggle) {
                    HStack(spacing: 8) {
                        if hasSelection {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.wine)
                        }
                        Text(cat.label)
                            .font(.cfSans(14, weight: .semibold))
                            .foregroundStyle(hasSelection ? Theme.ink : Theme.stone)
                        if count > 0 {
                            Text("\(count) SELECTED")
                                .font(.cfMono(8.5)).kerning(1.6)
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
                    .background(hasSelection ? Theme.wine.opacity(0.06) : Theme.surface)
                }
                .buttonStyle(.plain)

                if expanded {
                    VStack(alignment: .leading, spacing: 12) {
                        if !cat.items.isEmpty {
                            FlowLayout(spacing: 8) {
                                ForEach(cat.items, id: \.self) { item in
                                    pill(item)
                                }
                            }
                        }
                        HStack(spacing: 8) {
                            TextField(
                                cat.key == "other" ? "Type anything you like…" : "Add your own…",
                                text: $custom
                            )
                            .focused(focusedKey, equals: cat.key)
                            .submitLabel(.done)
                            .textInputAutocapitalization(.words)
                            .onSubmit { focusedKey.wrappedValue = nil }
                            .font(.cfSans(13))
                            .foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .background(Theme.surface, in: .capsule)
                            .overlay(Capsule().stroke(Theme.hairline))
                        }
                    }
                    .padding(14)
                    .background(Theme.surface.opacity(0.6))
                }
            }
            .background(Theme.surface, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16)
                .stroke(hasSelection ? Theme.wine : Theme.hairline,
                        lineWidth: hasSelection ? 1.5 : 1))
            .clipShape(.rect(cornerRadius: 16))
        }

        private func pill(_ item: String) -> some View {
            let selected = picks.contains(item)
            return Button {
                Haptics.tap()
                if selected { picks.remove(item) } else { picks.insert(item) }
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
                .background(selected ? Theme.wine : Theme.surface, in: .capsule)
                .overlay(Capsule().stroke(selected ? Color.clear : Theme.hairline))
            }
            .buttonStyle(.plain)
        }
    }
}
