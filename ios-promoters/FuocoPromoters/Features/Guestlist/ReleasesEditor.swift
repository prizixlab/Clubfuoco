import SwiftUI

/// The ticket-release ladder, edited inline under the entry price.
///
/// Off by default: most nights are one price, and a promoter who wants that
/// should never have to dismiss a wave editor to get it. Turning it on seeds
/// the first wave from the flat price already typed, so the common path —
/// "this price now, more later" — starts with the work already done.
struct ReleasesEditor: View {
    @Binding var releases: [TicketRelease]
    /// The flat price above, used to seed the first wave and to show what a
    /// ladder is replacing.
    let flatPriceCents: Int
    /// The night itself, so a cut-off can never be set after the doors open.
    let nightDate: Date

    @State private var editing: TicketRelease?

    private var on: Bool { !releases.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 13)).foregroundStyle(Theme.flame)
                Kicker("Releases", color: Theme.gold)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { on },
                    set: { want in
                        if want && releases.isEmpty {
                            // Seed with the price already typed — the promoter
                            // has told us the opening price once already.
                            releases = [TicketRelease(id: nil, position: 1, name: "Early bird",
                                                      priceCents: flatPriceCents,
                                                      endsAt: nil, quantity: nil)]
                        } else if !want {
                            releases = []
                        }
                    }))
                    .labelsHidden()
                    .tint(Theme.ember)
            }

            if !on {
                Text("One price the whole way. Turn this on to sell in waves — early bird, phase two, door — each with its own price, cut-off and ticket limit.")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            } else {
                ForEach(Array(releases.enumerated()), id: \.element.id) { index, release in
                    Button { editing = releases[index] } label: {
                        row(release, index: index)
                    }
                    .buttonStyle(.plain)
                }

                if let problem = ReleaseRules.problem(with: releases, nightPriceCents: flatPriceCents) {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 12)).foregroundStyle(Theme.wine)
                        Text(problem)
                            .font(.cfSans(12)).foregroundStyle(Theme.wine)
                    }
                }

                if releases.count < ReleaseRules.maxReleases {
                    Button {
                        Haptics.tap()
                        // A new wave opens above the last one's price, because
                        // that is the direction ticket prices move.
                        let last = releases.last
                        releases.append(TicketRelease(
                            id: nil, position: releases.count + 1, name: "",
                            priceCents: (last?.priceCents ?? flatPriceCents) + 500,
                            endsAt: nil, quantity: nil))
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                            Text("Add release").font(.cfSans(13, weight: .medium))
                        }
                        .foregroundStyle(Theme.flame)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.parchment.opacity(0.05)))
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("Twenty is the maximum.")
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentFaint)
                }

                Text("Each wave sells until its date passes or its tickets run out — whichever happens first. The last one runs to the door.")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
        }
        .sheet(item: $editing) { target in
            ReleaseDetailSheet(
                release: target,
                nightDate: nightDate,
                canDelete: releases.count > 1,
                onSave: { updated in
                    if let i = releases.firstIndex(where: { $0.id == updated.id && $0.position == updated.position }) {
                        releases[i] = updated
                    }
                    editing = nil
                },
                onDelete: {
                    releases.removeAll { $0.id == target.id && $0.position == target.position }
                    renumber()
                    editing = nil
                })
                .presentationBackground(Theme.night)
        }
    }

    /// Positions are the sale order and must stay 1…n with no gaps — the DB has
    /// a unique index on (night_id, position) and the server reads the order
    /// from it, so a hole would change which wave sells next.
    private func renumber() {
        for i in releases.indices { releases[i].position = i + 1 }
    }

    private func row(_ r: TicketRelease, index: Int) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(Theme.ember.opacity(0.15))
                    .frame(width: 30, height: 30)
                Text("\(index + 1)")
                    .font(.cfMono(12, weight: .medium)).foregroundStyle(Theme.ember)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(r.name.isEmpty ? "Release \(index + 1)" : r.name)
                    .font(.cfSans(14, weight: .medium))
                    .foregroundStyle(Theme.parchment)
                Text(subtitle(r))
                    .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Text(r.priceText)
                .font(.cfMono(14, weight: .medium)).foregroundStyle(Theme.flame)
            Image(systemName: "chevron.right")
                .font(.system(size: 11)).foregroundStyle(Theme.parchmentDim)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
        .contentShape(Rectangle())
    }

    private func subtitle(_ r: TicketRelease) -> String {
        var bits: [String] = []
        if let ends = r.endsAt {
            bits.append("until \(ends.formatted(.dateTime.day().month(.abbreviated).hour().minute()))")
        } else {
            bits.append("until doors")
        }
        bits.append(r.quantity.map { "\($0) tickets" } ?? "no limit")
        return bits.joined(separator: " · ")
    }
}

/// One wave, edited in full. A sheet rather than inline fields because a wave
/// carries four decisions and a date picker, which is more than a row can hold
/// without becoming unreadable on an iPhone.
private struct ReleaseDetailSheet: View {
    @State var release: TicketRelease
    let nightDate: Date
    let canDelete: Bool
    let onSave: (TicketRelease) -> Void
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var priceText = ""
    @State private var limited = false
    @State private var quantityText = ""
    @State private var hasCutoff = false
    @State private var cutoff = Date()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    field("Name (optional)") {
                        TextField("", text: $release.name,
                                  prompt: Text("Early bird").foregroundColor(Theme.parchmentFaint))
                            .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                            .padding(.vertical, 12).padding(.horizontal, 14)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.nightLift))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                    }

                    field("Price") {
                        HStack(spacing: 10) {
                            Text("€").font(.cfSerif(22)).foregroundStyle(Theme.parchmentDim)
                            TextField("", text: $priceText,
                                      prompt: Text("0").foregroundColor(Theme.parchmentFaint))
                                .keyboardType(.decimalPad)
                                .font(.cfMono(20)).foregroundStyle(Theme.parchment)
                        }
                        .padding(.vertical, 12).padding(.horizontal, 14)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.nightLift))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                    }

                    field("Switches on") {
                        VStack(alignment: .leading, spacing: 10) {
                            Toggle(isOn: $hasCutoff) {
                                Text("End on a date")
                                    .font(.cfSans(14)).foregroundStyle(Theme.parchment)
                            }
                            .tint(Theme.ember)

                            if hasCutoff {
                                DatePicker("", selection: $cutoff,
                                           in: Date()...max(nightDate, Date().addingTimeInterval(3600)),
                                           displayedComponents: [.date, .hourAndMinute])
                                    .datePickerStyle(.compact)
                                    .labelsHidden()
                                    .tint(Theme.ember)
                            } else {
                                Text("Runs until the doors open, or until its tickets run out.")
                                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                            }
                        }
                    }

                    field("Tickets in this release") {
                        VStack(alignment: .leading, spacing: 10) {
                            Toggle(isOn: $limited) {
                                Text("Limit how many")
                                    .font(.cfSans(14)).foregroundStyle(Theme.parchment)
                            }
                            .tint(Theme.ember)

                            if limited {
                                TextField("", text: $quantityText,
                                          prompt: Text("100").foregroundColor(Theme.parchmentFaint))
                                    .keyboardType(.numberPad)
                                    .font(.cfMono(18)).foregroundStyle(Theme.parchment)
                                    .padding(.vertical, 12).padding(.horizontal, 14)
                                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.nightLift))
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))
                                Text("Counted in people — a guest bringing two friends takes three.")
                                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                            } else {
                                Text("No limit — this release runs on its date alone.")
                                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                            }
                        }
                    }

                    if release.sold > 0 {
                        Text("\(release.sold) already sold in this release.")
                            .font(.cfSans(12)).foregroundStyle(Theme.flame)
                    }

                    if canDelete {
                        Button(role: .destructive) { onDelete() } label: {
                            Text("Remove this release")
                                .font(.cfSans(14, weight: .medium))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.wine.opacity(0.15)))
                    }
                }
                .padding(20)
            }
            .background(Theme.night.ignoresSafeArea())
            .navigationTitle("Release \(release.position)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(Theme.parchmentDim)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { save() }.tint(Theme.flame)
                }
            }
        }
        .onAppear {
            priceText = release.priceCents > 0
                ? String(format: release.priceCents % 100 == 0 ? "%.0f" : "%.2f", Double(release.priceCents) / 100)
                : ""
            limited = release.quantity != nil
            quantityText = release.quantity.map(String.init) ?? ""
            hasCutoff = release.endsAt != nil
            cutoff = release.endsAt ?? min(nightDate, Date().addingTimeInterval(86_400))
        }
    }

    private func save() {
        let cleaned = priceText.replacingOccurrences(of: ",", with: ".")
        release.priceCents = Int((Double(cleaned) ?? 0) * 100)
        release.quantity = limited ? Int(quantityText).flatMap { $0 > 0 ? $0 : nil } : nil
        release.endsAt = hasCutoff ? cutoff : nil
        onSave(release)
        dismiss()
    }

    private func field(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker(label, color: Theme.gold)
            content()
        }
    }
}
