import SwiftUI

// Create / edit one guestlist offer. Free vs VIP toggles the price field; VIP
// requires a price (mirrors the web OfferSchema so the server never rejects a
// well-formed sheet). club is fixed (offers don't move venues — delete + re-add).

struct OfferSheet: View {
    @ObservedObject var model: OffersHomeModel
    let existing: Offer?
    let clubId: UUID
    let onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    @State private var isVip: Bool
    @State private var featured: Bool
    @State private var billing: PromoterRepo.BillingStatus?
    @State private var checkingCard = false
    @State private var cardAttempted = false   // opened the Stripe card flow at least once
    @State private var cardDeclined = false     // came back from it still without a saved card
    @State private var title: String
    @State private var subtitle: String
    @State private var price: String
    @State private var partySize: String
    @State private var openTime: Date       // doors open
    @State private var closeTime: Date      // closes (next day if earlier)
    @State private var openClub: Bool       // "Same as club" — follows venue open
    @State private var closeClub: Bool      // "Same as club" — follows venue close
    @State private var capped: Bool         // limit total tickets this offer issues
    @State private var capacity: Int        // the ticket cap when `capped`
    @State private var validDays: String
    @State private var dressCode: String
    @State private var genres: Set<String>   // selected music tags
    @State private var otherMusic: String     // free text when "Other" is on
    @State private var busy = false
    @State private var error: String?
    @State private var submitted = false   // shows the pending-review screen

    init(model: OffersHomeModel, existing: Offer?, clubId: UUID, onDone: @escaping () async -> Void) {
        self.model = model
        self.existing = existing
        self.clubId = clubId
        self.onDone = onDone
        let vip = existing?.isVip ?? false
        _isVip       = State(initialValue: vip)
        _featured    = State(initialValue: existing?.isFeatured ?? false)
        _title       = State(initialValue: existing?.title ?? (vip ? "VIP Table" : "Free Guestlist"))
        _subtitle    = State(initialValue: existing?.subtitle ?? "")
        _price       = State(initialValue: existing?.priceEur.map { String(Int($0)) } ?? "")
        _partySize   = State(initialValue: existing?.partySize.map(String.init) ?? "")
        let times = Self.parseWindow(existing?.timeWindow)
        _openTime    = State(initialValue: times?.0 ?? Self.time(23, 0))   // 11:00 PM default
        _closeTime   = State(initialValue: times?.1 ?? Self.time(3, 0))    // 3:00 AM default
        // A legacy free-text window ("Door open till closing") has no parsable
        // times — read it as "same as club" on both sides.
        let legacyFollows = existing != nil && times == nil
        _openClub    = State(initialValue: legacyFollows)
        _closeClub   = State(initialValue: legacyFollows)
        // Total tickets the offer may issue per night (nil = no limit).
        _capped      = State(initialValue: existing?.capacity != nil)
        _capacity    = State(initialValue: existing?.capacity ?? 100)
        _validDays   = State(initialValue: existing?.validDays ?? "")
        _dressCode   = State(initialValue: existing?.dressCode ?? "")
        let parsedMusic = Self.parseMusic(existing?.music)
        _genres      = State(initialValue: parsedMusic.genres)
        _otherMusic  = State(initialValue: parsedMusic.other)
    }

    private var cardOnFile: Bool { billing?.cardVerified == true }

    // Human-readable door hours built from the two clock pickers. When the close
    // time is earlier than the open time it crosses midnight, so we say "next
    // day" — and, if the offer runs on a single weekday, name both nights
    // (e.g. "Wed 11:00 PM – Thu 3:00 AM").
    private var timeWindow: String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "h:mm a"
        let open = f.string(from: openTime), close = f.string(from: closeTime)

        // One or both sides deferring to the venue's own hours.
        switch (openClub, closeClub) {
        case (true, true):   return "Venue hours"
        case (true, false):  return "From open till \(close)"
        case (false, true):  return "\(open) till close"
        case (false, false): break   // both concrete → fall through
        }

        let cal = Calendar.current
        let om = cal.component(.hour, from: openTime) * 60 + cal.component(.minute, from: openTime)
        let cm = cal.component(.hour, from: closeTime) * 60 + cal.component(.minute, from: closeTime)
        let crosses = cm <= om
        let days = ValidDays.parse(validDays)
        let labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        if days.count == 1, let d = days.first {
            let startDay = labels[d]
            let endDay = labels[crosses ? (d + 1) % 7 : d]
            return "\(startDay) \(open) – \(endDay) \(close)"
        }
        return crosses ? "\(open) – \(close) (next day)" : "\(open) – \(close)"
    }

    /// Canonical music tags — the same set the consumer survey uses at signup
    /// (SurveySheet.tsx). "Other" reveals a free-text field.
    static let musicGenres = [
        "House", "Techno", "Italo Disco", "Hip-Hop",
        "R&B", "Reggaeton", "Live Band", "Jazz",
        "Afro", "Pop", "Indie", "Other",
    ]

    /// Selected tags joined into the stored `music` string; "Other" is replaced
    /// by the typed value.
    private var music: String {
        var parts = Self.musicGenres.filter { $0 != "Other" && genres.contains($0) }
        if genres.contains("Other") {
            let o = otherMusic.trimmed
            if !o.isEmpty { parts.append(o) }
        }
        return parts.joined(separator: ", ")
    }

    private var valid: Bool {
        !title.trimmed.isEmpty && !subtitle.trimmed.isEmpty && !validDays.trimmed.isEmpty &&
        !dressCode.trimmed.isEmpty && !music.trimmed.isEmpty &&
        (!isVip || (Double(price) ?? 0) > 0) &&
        // Front-screen promotion requires a verified card on file.
        (!featured || cardOnFile)
    }

    var body: some View {
        if submitted {
            ReviewSubmittedScreen { dismiss() }
        } else {
            editor
        }
    }

    private var editor: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Picker("Kind", selection: $isVip) {
                            Text("Free Guestlist").tag(false)
                            Text("VIP Table").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: isVip) { _, vip in
                            if title == "Free Guestlist" || title == "VIP Table" {
                                title = vip ? "VIP Table" : "Free Guestlist"
                            }
                        }

                        field("Title", $title)
                        field("Subtitle", $subtitle, hint: isVip ? "e.g. From €300 · 5 people · Fully consumable" : "e.g. Free till 1:00 AM")
                        if isVip {
                            field("Price (EUR)", $price, keyboard: .numberPad)
                            field("Table size", $partySize, keyboard: .numberPad,
                                  hint: "How many people the table is for — e.g. 5")
                        }
                        capacityCard
                        hoursPicker
                        validDaysPicker
                        field("Dress code", $dressCode)
                        musicPicker

                        featuredCard

                        if let error { Text(error).font(.cfSans(13)).foregroundStyle(Theme.flame) }
                    }
                    .padding(20)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .task { billing = try? await PromoterRepo().billingStatus() }
            .onChange(of: checkingCard) { _, checking in
                // Re-check card status when returning from the Stripe setup flow.
                // Only assign on a real response — a failed fetch must not clobber
                // a known-good status with nil.
                if !checking {
                    Task { if let s = try? await PromoterRepo().billingStatus() { billing = s } }
                }
            }
            .onChange(of: scenePhase) { _, phase in
                // Coming back from the hosted Stripe card page: if they'd started
                // it and still have no saved card, the card was declined or they
                // backed out — surface a clear "try another" hint.
                guard phase == .active, cardAttempted else { return }
                Task {
                    // Only trust an actual response: a transient network error must
                    // NOT read as "declined" (that would flash a false failure on a
                    // card that saved fine). On error, leave the state untouched.
                    guard let status = try? await PromoterRepo().billingStatus() else { return }
                    billing = status
                    if status.cardVerified {
                        cardAttempted = false
                        cardDeclined = false
                    } else {
                        cardDeclined = true
                    }
                }
            }
            .navigationTitle(existing == nil ? "New offer" : "Edit offer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }.disabled(!valid || busy)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        UIApplication.shared.sendAction(
                            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                    .foregroundStyle(Theme.ember)
                }
            }
        }
        .tint(Theme.ember)
    }

    // Day picker for valid_days — reads the stored text into toggles and writes
    // back a canonical string ("Every night" or an explicit comma list) so the
    // Tonight filter parses it reliably.
    private let dayOrder = [1, 2, 3, 4, 5, 6, 0]   // Mon…Sun (index: 0=Sun…6=Sat)
    private let dayLabels: [Int: String] = [0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"]

    private var validDaysPicker: some View {
        let selected = ValidDays.parse(validDays)
        let every = selected.count >= 7
        return VStack(alignment: .leading, spacing: 8) {
            Text("VALID DAYS").font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.parchmentDim)
            dayChip("Every night", active: every) { validDays = every ? "" : "Every night" }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(dayOrder, id: \.self) { idx in
                        dayChip(dayLabels[idx] ?? "", active: !every && selected.contains(idx)) {
                            var s = selected
                            if s.contains(idx) { s.remove(idx) } else { s.insert(idx) }
                            validDays = Self.daysToString(s)
                        }
                    }
                }
            }
        }
    }

    private func dayChip(_ label: String, active: Bool, _ action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            Text(label)
                .font(.cfSans(13, weight: .medium))
                .foregroundStyle(active ? .black : Theme.parchment)
                .padding(.horizontal, 13).padding(.vertical, 8)
                .background(active ? Theme.ember : .clear, in: Capsule())
                .overlay(Capsule().stroke(active ? .clear : Theme.hairline))
        }
    }

    static func daysToString(_ set: Set<Int>) -> String {
        if set.count >= 7 { return "Every night" }
        let order = [1, 2, 3, 4, 5, 6, 0]
        let labels = [0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"]
        return order.filter { set.contains($0) }.compactMap { labels[$0] }.joined(separator: ", ")
    }

    // Paid front-screen promotion — mirrors the private-event featuredCard so
    // a public offer can be pinned to the Fuoco home screen on the same terms.
    private var featuredCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles").font(.system(size: 13)).foregroundStyle(Theme.flame)
                Kicker("Front-screen promotion", color: Theme.flame)
            }
            Toggle(isOn: $featured.animation()) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Feature on the Fuoco home screen")
                        .font(.cfSans(14, weight: .medium)).foregroundStyle(Theme.parchment)
                    Text("Your offer shows on \(model.clubName(clubId))’s screen like any other — featuring also pushes it to the front so every Fuoco member sees it first.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
            }
            .tint(Theme.ember)

            if featured {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "eurosign.circle").font(.system(size: 13)).foregroundStyle(Theme.flame)
                    Text("**€0.30 per guest who accepts**, billed one week after each night it runs. You only pay for people who actually book — nothing upfront.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.flame.opacity(0.08)))

                if let b = billing, b.cardVerified {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.gold).font(.system(size: 13))
                        Text("\(b.cardBrand?.capitalized ?? "Card") ending \(b.cardLast4 ?? "••••") on file")
                            .font(.cfSans(12)).foregroundStyle(Theme.parchment)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            Task {
                                checkingCard = true
                                cardDeclined = false
                                if let url = try? await PromoterRepo().billingSetupURL() {
                                    cardAttempted = true
                                    openURL(url)
                                }
                                checkingCard = false
                            }
                        } label: {
                            HStack(spacing: 8) {
                                if checkingCard { ProgressView().tint(Theme.parchment).scaleEffect(0.8) }
                                else { Image(systemName: "creditcard") }
                                Text(cardDeclined ? "Try another card" : "Add a payment method to enable")
                                    .font(.cfSans(13, weight: .medium))
                            }
                            .foregroundStyle(Theme.parchment)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .overlay(RoundedRectangle(cornerRadius: Theme.radiusPill)
                                .stroke(cardDeclined ? Theme.wine : Theme.parchmentFaint))
                        }
                        if cardDeclined {
                            // Came back with no card saved — declined or backed out.
                            Text("That card wasn’t added — it may have been declined. Try another card. Nothing was charged.")
                                .font(.cfSans(11)).foregroundStyle(Theme.wine)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            // Reassure before they see €2.00 on the card form: it's a
                            // liveness check, not a charge (matches the Promoter Terms).
                            Text("We’re not charging you — we place a temporary €2 hold just to check the card is good, and it’s released right away.")
                                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    // Door hours as two real clock pickers, with a live preview of the window
    // string that gets saved (and shown on the club's screen).
    private var hoursPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("HOURS OFFER IS VALID").font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.parchmentDim)
            HStack(spacing: 12) {
                timeCell("Doors open", time: $openTime, follows: $openClub)
                timeCell("Closes", time: $closeTime, follows: $closeClub)
            }
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 11)).foregroundStyle(Theme.flame)
                Text(timeWindow).font(.cfSans(13, weight: .medium)).foregroundStyle(Theme.flame)
            }
        }
    }

    private func timeCell(_ label: String, time: Binding<Date>, follows: Binding<Bool>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(label.uppercased()).font(.cfMono(9, weight: .medium)).kerning(1).foregroundStyle(Theme.parchmentDim)
                Spacer(minLength: 4)
                Button {
                    Haptics.tap(); follows.wrappedValue.toggle()
                } label: {
                    Text("Same as club")
                        .font(.cfMono(8, weight: .medium)).kerning(0.5)
                        .foregroundStyle(follows.wrappedValue ? Theme.emberCream : Theme.parchmentDim)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(follows.wrappedValue ? Theme.ember : .clear))
                        .overlay(Capsule().stroke(follows.wrappedValue ? .clear : Theme.parchmentFaint))
                }
            }
            if follows.wrappedValue {
                HStack(spacing: 6) {
                    Image(systemName: "building.2").font(.system(size: 12)).foregroundStyle(Theme.parchmentDim)
                    Text("Follows the venue").font(.cfSans(13)).foregroundStyle(Theme.parchment)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 5)
            } else {
                DatePicker("", selection: time, displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .colorScheme(.dark)
                    .tint(Theme.ember)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.hairline))
    }

    /// A Date at a fixed hour/minute today — the picker only reads the time.
    static func time(_ hour: Int, _ minute: Int) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }

    /// Pull the first two "h:mm AM/PM" clock times out of a saved window string
    /// so editing an offer restores the pickers. nil = legacy free-text window.
    static func parseWindow(_ s: String?) -> (Date, Date)? {
        guard let s else { return nil }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "h:mm a"
        let ns = s as NSString
        guard let rx = try? NSRegularExpression(pattern: #"\d{1,2}:\d{2}\s?[AP]M"#, options: [.caseInsensitive])
        else { return nil }
        let times = rx.matches(in: s, range: NSRange(location: 0, length: ns.length))
            .compactMap { f.date(from: ns.substring(with: $0.range).uppercased()) }
        return times.count >= 2 ? (times[0], times[1]) : nil
    }

    // How many tickets/spots the offer can issue per night — "No limit" or a
    // custom cap (stored in the offer's capacity, enforced at join time).
    private var capacityCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(isVip ? "TABLES WE CAN ISSUE" : "TICKETS WE CAN ISSUE")
                    .font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.parchmentDim)
                Spacer()
                Button {
                    Haptics.tap(); withAnimation { capped.toggle() }
                } label: {
                    Text("No limit")
                        .font(.cfMono(9, weight: .medium)).kerning(1.2)
                        .foregroundStyle(capped ? Theme.parchmentDim : Theme.emberCream)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(capped ? Color.clear : Theme.ember))
                        .overlay(Capsule().stroke(capped ? Theme.parchmentFaint : Color.clear))
                }
            }
            Text(capped ? "Once this many are claimed for a night, the offer closes for that night."
                        : "The offer stays open — no cap on how many can claim it.")
                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)

            if capped {
                // Fine ±1 with a directly-typable number in the middle…
                HStack(spacing: 14) {
                    capacityStep("minus", -1)
                    TextField("", text: Binding(
                        get: { String(capacity) },
                        set: { capacity = Self.clampCap(Int($0.filter(\.isNumber)) ?? 0) }))
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.center)
                        .font(.cfSerif(30)).foregroundStyle(Theme.parchment)
                        .frame(maxWidth: .infinity)
                    capacityStep("plus", 1)
                }
                // …plus quick jumps in denominations to reach a big number fast.
                HStack(spacing: 8) {
                    ForEach(isVip ? [2, 5, 10] : [10, 25, 50, 100], id: \.self) { d in
                        Button {
                            Haptics.tap(); capacity = Self.clampCap(capacity + d)
                        } label: {
                            Text("+\(d)")
                                .font(.cfMono(12, weight: .medium))
                                .foregroundStyle(Theme.parchment)
                                .frame(maxWidth: .infinity).padding(.vertical, 9)
                                .background(Capsule().fill(Theme.night))
                                .overlay(Capsule().stroke(Theme.hairline))
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    private func capacityStep(_ icon: String, _ delta: Int) -> some View {
        Button { Haptics.tap(); capacity = Self.clampCap(capacity + delta) } label: {
            Image(systemName: icon)
                .foregroundStyle(delta > 0 ? Theme.emberCream : Theme.parchment)
                .frame(width: 40, height: 40)
                .background(Circle().fill(delta > 0 ? Theme.ember : Color.clear))
                .overlay(Circle().stroke(delta > 0 ? Color.clear : Theme.parchmentFaint))
        }
    }

    static func clampCap(_ n: Int) -> Int { min(5000, max(1, n)) }

    // Music tags as multi-select chips (same set as the consumer survey), with
    // a free-text box when "Other" is chosen.
    private var musicPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("MUSIC").font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.parchmentDim)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                ForEach(Self.musicGenres, id: \.self) { g in
                    let on = genres.contains(g)
                    Button {
                        Haptics.tap()
                        if on { genres.remove(g) } else { genres.insert(g) }
                    } label: {
                        Text(g)
                            .font(.cfSans(13, weight: .medium))
                            .foregroundStyle(on ? .black : Theme.parchment)
                            .lineLimit(1).minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(on ? Theme.ember : .clear, in: Capsule())
                            .overlay(Capsule().stroke(on ? .clear : Theme.hairline))
                    }
                }
            }
            if genres.contains("Other") {
                TextField("", text: $otherMusic,
                          prompt: Text("Name the genre").foregroundStyle(Theme.parchmentDim))
                    .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Theme.nightLift))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.hairline))
            }
        }
    }

    /// Split a stored `music` string back into known tags + an "Other" free
    /// text so editing an offer restores the chips. Unknown tokens → "Other".
    static func parseMusic(_ s: String?) -> (genres: Set<String>, other: String) {
        guard let s, !s.trimmed.isEmpty else { return ([], "") }
        let tokens = s.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        var g = Set<String>(); var others: [String] = []
        for t in tokens {
            if let match = musicGenres.first(where: { $0.caseInsensitiveCompare(t) == .orderedSame }), match != "Other" {
                g.insert(match)
            } else {
                others.append(t)
            }
        }
        if !others.isEmpty { g.insert("Other") }
        return (g, others.joined(separator: ", "))
    }

    private func field(_ label: String, _ text: Binding<String>, keyboard: UIKeyboardType = .default, hint: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.cfMono(10, weight: .medium)).kerning(1.5).foregroundStyle(Theme.parchmentDim)
            TextField(hint ?? label, text: text)
                .keyboardType(keyboard)
                .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.nightLift))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.hairline))
        }
    }

    private func save() async {
        busy = true; error = nil
        let draft = OfferDraft(
            clubId: clubId,
            kind: isVip ? "vip_table" : "free_guestlist",
            title: title.trimmed,
            subtitle: subtitle.trimmed,
            priceEur: isVip ? Double(price) : nil,
            partySize: isVip ? Int(partySize) : nil,
            timeWindow: timeWindow.trimmed,
            validDays: validDays.trimmed,
            dressCode: dressCode.trimmed,
            music: music.trimmed,
            sortOrder: existing?.sortOrder,
            featured: featured,
            capacity: capped ? capacity : nil
        )
        do {
            let repo = OfferRepo()
            let pending: Bool
            if let existing { pending = try await repo.update(id: existing.id, draft) }
            else { pending = try await repo.create(draft) }
            Haptics.success()
            await onDone()
            if pending { submitted = true } else { dismiss() }
        } catch {
            Haptics.error()
            self.error = (error as? LocalizedError)?.errorDescription ?? "Save failed."
        }
        busy = false
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
