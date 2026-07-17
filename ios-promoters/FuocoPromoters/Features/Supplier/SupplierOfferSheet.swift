import SwiftUI

// Create / edit one guestlist offer. Free vs VIP toggles the price field; VIP
// requires a price (mirrors the web OfferSchema so the server never rejects a
// well-formed sheet). club is fixed (offers don't move venues — delete + re-add).

struct SupplierOfferSheet: View {
    @ObservedObject var model: SupplierHomeModel
    let existing: SupplierOffer?
    let clubId: UUID
    let onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var isVip: Bool
    @State private var title: String
    @State private var subtitle: String
    @State private var price: String
    @State private var partySize: String
    @State private var timeWindow: String
    @State private var validDays: String
    @State private var dressCode: String
    @State private var music: String
    @State private var busy = false
    @State private var error: String?
    @State private var submitted = false   // shows the pending-review screen

    init(model: SupplierHomeModel, existing: SupplierOffer?, clubId: UUID, onDone: @escaping () async -> Void) {
        self.model = model
        self.existing = existing
        self.clubId = clubId
        self.onDone = onDone
        let vip = existing?.isVip ?? false
        _isVip       = State(initialValue: vip)
        _title       = State(initialValue: existing?.title ?? (vip ? "VIP Table" : "Free Guestlist"))
        _subtitle    = State(initialValue: existing?.subtitle ?? "")
        _price       = State(initialValue: existing?.priceEur.map { String(Int($0)) } ?? "")
        _partySize   = State(initialValue: existing?.partySize.map(String.init) ?? "")
        _timeWindow  = State(initialValue: existing?.timeWindow ?? (vip ? "Reservation for the night" : "Door open till closing"))
        _validDays   = State(initialValue: existing?.validDays ?? "")
        _dressCode   = State(initialValue: existing?.dressCode ?? "")
        _music       = State(initialValue: existing?.music ?? "")
    }

    private var valid: Bool {
        !title.trimmed.isEmpty && !subtitle.trimmed.isEmpty && !validDays.trimmed.isEmpty &&
        !dressCode.trimmed.isEmpty && !music.trimmed.isEmpty && !timeWindow.trimmed.isEmpty &&
        (!isVip || (Double(price) ?? 0) > 0)
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
                            if vip, timeWindow == "Door open till closing" { timeWindow = "Reservation for the night" }
                            if !vip, timeWindow == "Reservation for the night" { timeWindow = "Door open till closing" }
                        }

                        field("Title", $title)
                        field("Subtitle", $subtitle, hint: isVip ? "e.g. From €300 · 5 people · Fully consumable" : "e.g. Free till 1:00 AM")
                        if isVip { field("Price (EUR)", $price, keyboard: .numberPad) }
                        field("Party size", $partySize, keyboard: .numberPad, hint: isVip ? "e.g. 5" : "optional")
                        field("Time window", $timeWindow)
                        validDaysPicker
                        field("Dress code", $dressCode)
                        field("Music", $music)

                        if let error { Text(error).font(.cfSans(13)).foregroundStyle(Theme.flame) }
                    }
                    .padding(20)
                }
            }
            .navigationTitle(existing == nil ? "New offer" : "Edit offer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }.disabled(!valid || busy)
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
        let draft = SupplierOfferDraft(
            clubId: clubId,
            kind: isVip ? "vip_table" : "free_guestlist",
            title: title.trimmed,
            subtitle: subtitle.trimmed,
            priceEur: isVip ? Double(price) : nil,
            partySize: Int(partySize),
            timeWindow: timeWindow.trimmed,
            validDays: validDays.trimmed,
            dressCode: dressCode.trimmed,
            music: music.trimmed,
            sortOrder: existing?.sortOrder
        )
        do {
            let repo = SupplierRepo()
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
