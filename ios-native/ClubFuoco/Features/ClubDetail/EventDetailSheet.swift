import SwiftUI

/// Everything we hold about one event, opened by tapping its card on a club
/// page. Port of "Club Fuoco Event Page" from the design project.
///
/// The design was drawn from measured coverage (docs/event-detail-data-brief.md)
/// and covers four real states, all of which this must survive:
///   1. rich      — flyer, copy, several linked DJs, age, capacity
///   2. no lineup — 29% of events bill no artists at all
///   3. floor     — no flyer AND no copy: title, time, venue, promoter only
///   4. unlinked  — credits that are real names but not DJs we hold
///
/// Nothing here is faked when absent: a missing flyer removes the image, a
/// missing lineup says so, and the two fields that lie (`cost`, `venue_capacity`)
/// are gated behind validators on ClubEvent rather than shown raw.
struct EventDetailSheet<DJPage: View>: View {
    let event: ClubEvent
    /// Credits resolved to DJ pages — by RA id first, name as legacy fallback.
    let djFor: (LineupCredit) -> FeaturedDJ?
    /// The DJ page for a lineup row. It is presented BY this sheet rather than
    /// handed back to the club page, so a DJ opens on top of the event and
    /// closing them returns here — reading a lineup shouldn't cost you the
    /// event you were reading it on.
    @ViewBuilder var djPage: (FeaturedDJ) -> DJPage

    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleStore.self) private var locale
    @State private var descriptionExpanded = false
    @State private var openDJ: FeaturedDJ?

    private var lineStrong: Color { Theme.fadedSand.opacity(0.34) }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let raw = event.image, let url = URL(string: raw) {
                        flyer(url)
                    }
                    head
                    if let copy = descriptionText { description(copy) }
                    lineupSection
                    if let venue = event.venueName, !venue.isEmpty { venueRow(venue) }
                    Color.clear.frame(height: 8)
                }
            }
            .scrollIndicators(.hidden)
        }
        .background(Theme.cream)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .sheet(item: $openDJ) { djPage($0) }
    }

    // ── Chrome ────────────────────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Text(locale.t("event.label").uppercased())
                .font(.cfMono(9.5)).kerning(1.9)
                .foregroundStyle(Theme.fadedSand)
            Spacer()
            HStack(spacing: 8) {
                ShareLink(item: shareText) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.stone)
                        .frame(width: 34, height: 34)
                        .background(Theme.surfaceRaised, in: .circle)
                }
                .buttonStyle(.plain)
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.stone)
                        .frame(width: 34, height: 34)
                        .background(Theme.surfaceRaised, in: .circle)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6).padding(.bottom, 4)
    }

    private func flyer(_ url: URL) -> some View {
        CachedAsyncImage(url: url, targetWidth: 800) {
            $0.resizable().aspectRatio(contentMode: .fill)
        } placeholder: {
            Theme.imagePlaceholder
        }
        .frame(maxWidth: .infinity)
        .frame(height: 200)
        .clipped()
        .clipShape(.rect(cornerRadius: 16))
        .padding(.horizontal, 18)
        .padding(.top, 6)
    }

    // ── Head ──────────────────────────────────────────────────────────────────

    private var head: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(kicker.uppercased())
                .font(.cfMono(9.5)).kerning(1.5)
                .foregroundStyle(Theme.ember)
                .padding(.bottom, 8)

            Text(event.title)
                .font(.cfSerif(27, italic: true))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)

            metaRow.padding(.top, 12)

            if let promoters = event.promoters, !promoters.isEmpty {
                Text(String(format: locale.t("detail.presentedBy"),
                            promoters.joined(separator: ", ")))
                    .font(.cfSans(12.5))
                    .foregroundStyle(Theme.fadedSand)
                    .padding(.top, 8)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Only rendered when the source actually gave a usable value — see
            // entryLabel / capacityLabel.
            if event.entryLabel != nil || event.capacityLabel != nil {
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    if let entry = event.entryLabel {
                        chip(locale.t("event.entry"), entry)
                    }
                    if let cap = event.capacityLabel {
                        chip(locale.t("event.capacity"), cap)
                    }
                }
                .padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, event.image == nil ? 20 : 16)
    }

    /// "Sat · Sub Rosa"
    private var kicker: String {
        [event.dateParts.weekday, event.venueName]
            .compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private var metaRow: some View {
        FlowLayout(spacing: 10, lineSpacing: 8) {
            Text(dayLabel)
            if let range = event.timeRange {
                dot
                HStack(spacing: 4) {
                    Text(range.label)
                    // The end time usually belongs to the next day; say so
                    // rather than letting "23:00 – 06:00" read as one morning.
                    if range.crossesMidnight {
                        Text("+1").foregroundStyle(Theme.fadedSand)
                    }
                }
            }
            if let age = event.minimumAge {
                dot
                Text("\(age)+")
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .overlay(Capsule().stroke(lineStrong))
            }
            if let n = event.interested, n > 0 {
                dot
                Text(String(format: locale.t("event.interestedCount"), compact(n)))
            }
        }
        .font(.cfMono(10.5)).kerning(0.8)
        .foregroundStyle(Theme.stone)
    }

    private var dot: some View {
        Circle().fill(Theme.fadedSand).frame(width: 3, height: 3)
    }

    private func chip(_ label: String, _ value: String) -> some View {
        HStack(spacing: 5) {
            Text(label.uppercased())
                .font(.cfMono(9.5)).kerning(0.8)
                .foregroundStyle(Theme.stone)
            Text(value)
                .font(.cfMono(9.5, weight: .semibold)).kerning(0.8)
                .foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Theme.surfaceRaised, in: .capsule)
        .overlay(Capsule().stroke(lineStrong))
    }

    // ── Description ───────────────────────────────────────────────────────────

    /// Promoter copy, but only when there is enough of it to be worth a section.
    /// A handful of rows carry a few characters of nothing.
    private var descriptionText: String? {
        guard let d = event.description?.trimmingCharacters(in: .whitespacesAndNewlines),
              d.count >= 40 else { return nil }
        return d
    }

    private func description(_ copy: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(copy)
                .font(.cfSans(13.5))
                .foregroundStyle(Theme.stone)
                .lineSpacing(4)
                .lineLimit(descriptionExpanded ? nil : 5)
                .fixedSize(horizontal: false, vertical: true)
            // Median copy is ~640 characters of marketing prose, so it is
            // clamped rather than allowed to push the lineup off the screen.
            if copy.count > 260 {
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) { descriptionExpanded.toggle() }
                } label: {
                    Text(locale.t(descriptionExpanded ? "event.less" : "event.more").uppercased())
                        .font(.cfMono(9.5)).kerning(1)
                        .foregroundStyle(Theme.ember)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, 18)
    }

    // ── Lineup ────────────────────────────────────────────────────────────────

    private var lineupSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(locale.t("event.lineup").uppercased())
                .font(.cfMono(9.5)).kerning(1.9)
                .foregroundStyle(Theme.ember)
                .padding(.bottom, 12)

            if event.credits.isEmpty {
                // 29% of events bill nobody. Say that plainly instead of
                // rendering an empty section.
                Text(locale.t("event.noLineup"))
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(event.credits.enumerated()), id: \.element.key) { i, credit in
                        lineupRow(credit, isFirst: i == 0, showsDivider: i > 0)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, 20)
    }

    private func lineupRow(_ credit: LineupCredit, isFirst: Bool, showsDivider: Bool) -> some View {
        let dj = djFor(credit)
        return VStack(spacing: 0) {
            if showsDivider { Rectangle().fill(Theme.hairline).frame(height: 1) }
            Button {
                if let dj { Haptics.tap(); openDJ = dj }
            } label: {
                HStack(spacing: 12) {
                    avatar(dj, name: credit.name)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(credit.name)
                            .font(.cfSans(14.5, weight: .semibold))
                            .foregroundStyle(dj == nil ? Theme.stone : Theme.ink)
                            .lineLimit(1)
                        // RA bills in order, so the first name is the headliner.
                        if isFirst, event.credits.count > 1 {
                            Text(locale.t("event.headliner").uppercased())
                                .font(.cfMono(9)).kerning(1)
                                .foregroundStyle(Theme.fadedSand)
                        }
                    }
                    Spacer(minLength: 8)
                    if dj != nil {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.ember)
                    }
                }
                .padding(.vertical, 11)
                // The row is one target. Without this the Spacer between the
                // name and the chevron is empty space that hit-tests to
                // nothing, leaving two live islands with a dead gap between
                // them — and the gap is the widest part of the row.
                .contentShape(Rectangle())
                // A name we hold no page for is real and stays listed — it just
                // cannot be opened, and is dimmed so the affordance is honest.
                .opacity(dj == nil ? 0.55 : 1)
            }
            .buttonStyle(.plain)
            .disabled(dj == nil)
        }
    }

    private func avatar(_ dj: FeaturedDJ?, name: String) -> some View {
        Group {
            if let raw = dj?.imageUrl, let url = URL(string: raw) {
                CachedAsyncImage(url: url, targetWidth: 120) {
                    $0.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { initialTile(name) }
            } else {
                initialTile(name)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(.circle)
    }

    private func initialTile(_ name: String) -> some View {
        Theme.surfaceRaised.overlay(
            Text(String(name.prefix(1)).uppercased())
                .font(.cfSerif(16, italic: true))
                .foregroundStyle(Theme.fadedSand)
        )
    }

    // ── Venue ─────────────────────────────────────────────────────────────────

    private func venueRow(_ venue: String) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(locale.t("event.venue").uppercased())
                    .font(.cfMono(9)).kerning(1.6)
                    .foregroundStyle(Theme.fadedSand)
                Text(venue)
                    .font(.cfSans(15.5, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(lineStrong))
        .padding(.horizontal, 18)
        .padding(.top, 16)
    }

    // ── Formatting ────────────────────────────────────────────────────────────

    private var dayLabel: String {
        let p = event.dateParts
        return "\(p.day) \(p.month.capitalized)"
    }

    /// 1042 → "1k". The counts run from single digits to four figures.
    private func compact(_ n: Int) -> String {
        n >= 1000 ? String(format: "%.1fk", Double(n) / 1000) : "\(n)"
    }

    private var shareText: String {
        [event.title, dayLabel, event.venueName]
            .compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}
