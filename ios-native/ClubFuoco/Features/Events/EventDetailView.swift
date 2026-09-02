import SwiftUI

/// The event page, built to the "Event Page.html" artboard.
///
/// Structure, top to bottom: a 352pt hero carrying the night's markers, a body
/// sheet that slides up over its lower edge, then title → sub → hosts →
/// line-up → about → details, with the reserve dock pinned to the bottom. Once
/// the hero scrolls away a blurred bar takes over with the title centred in it.
///
/// Reserving writes an ordinary BOOKING, so the spot inherits the pass, the
/// Tickets tab, arrival check-in, Wallet and the post-night venue survey. The
/// server also puts the guest on the night's door list, which is what the
/// room's capacity is counted against.
struct EventDetailView: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    /// The dock's five states, exactly as the artboard's state sheet lists them.
    private enum ReserveState { case ready, working, reserved, full, signedOut }

    @State private var reserved = false
    @State private var full = false
    @State private var working = false
    @State private var errorText: String?
    @State private var showGuestGate = false
    @State private var showCancelConfirm = false
    @State private var showPass = false
    @State private var bookingId: String?
    @State private var scanToken: String?
    @State private var reference: String?
    /// How far the flow has scrolled, for the collapsing bar.
    @State private var scrollY: CGFloat = 0

    private var state: ReserveState {
        if working { return .working }
        if !auth.hasAccount { return .signedOut }
        if reserved { return .reserved }
        if full { return .full }
        return .ready
    }

    /// An event with no photo has no hero to scroll past, so its bar is always
    /// there — matching the artboard's `.ev-body--nophoto` case.
    private var barShown: Bool { event.image == nil || scrollY > 300 }

    var body: some View {
        ZStack(alignment: .top) {
            Explore.bg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if event.image != nil { hero }
                    sheet
                }
                .background(scrollTracker)
            }
            .coordinateSpace(name: "evScroll")
            .ignoresSafeArea(edges: event.image != nil ? .top : [])

            if barShown { collapsedBar.transition(.opacity) }
            topControls
        }
        .background(Explore.bg)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) { dock }
        .animation(.easeOut(duration: 0.18), value: barShown)
        .sheet(isPresented: $showGuestGate) {
            GuestGateView(reason: .save).presentationDetents([.medium])
        }
        .sheet(isPresented: $showPass) {
            if let bookingId {
                ReservedSheet(event: event, bookingId: bookingId,
                              scanToken: scanToken, reference: reference)
                    .presentationDetents([.large])
            }
        }
        // An alert, not a confirmationDialog or a popover. Both of those
        // anchor to whatever presented them, and from a control docked at the
        // bottom of the screen they surface as a tailed bubble sitting over the
        // tab bar. An alert is always a centred modal and cannot be
        // mispositioned.
        .alert(
            locale.t("events.cancelTitle"),
            isPresented: $showCancelConfirm
        ) {
            Button(locale.t("events.cancelConfirm"), role: .destructive) {
                Task { await cancel() }
            }
            Button(locale.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(locale.t("events.cancelBody"))
        }
        .task { await loadState() }
    }

    // ── Scroll tracking ───────────────────────────────────────────────────────

    private struct OffsetKey: PreferenceKey {
        static var defaultValue: CGFloat = 0
        static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
    }

    /// A zero-size probe rather than `onScrollGeometryChange`, which needs
    /// iOS 18 — this app targets 17.
    private var scrollTracker: some View {
        GeometryReader { geo in
            Color.clear.preference(
                key: OffsetKey.self,
                value: -geo.frame(in: .named("evScroll")).minY
            )
        }
        .onPreferenceChange(OffsetKey.self) { scrollY = $0 }
    }

    // ── Hero ──────────────────────────────────────────────────────────────────

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            Explore.photoPlaceholder
                .overlay {
                    if let url = event.image.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                            placeholder: { Explore.photoPlaceholder }
                    }
                }
                .overlay { GrainOverlay().opacity(0.6) }
                // Runs all the way to the page colour at the foot, so the sheet
                // emerges from the photo rather than cutting it off.
                .overlay(
                    LinearGradient(
                        stops: [
                            .init(color: .black.opacity(0.55), location: 0),
                            .init(color: .clear, location: 0.34),
                            .init(color: .black.opacity(0.15), location: 0.58),
                            .init(color: Explore.bg, location: 0.99),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .frame(height: 352)
                .clipped()

            VStack(alignment: .leading, spacing: 10) {
                if event.pinned { pickPill }
                whenPill
            }
            .padding(20)
        }
        .frame(height: 352)
    }

    private var pickPill: some View {
        HStack(spacing: 6) {
            Image(systemName: "star.fill").font(.system(size: 9))
            Text(locale.t("events.pickTag").uppercased())
                .font(.cfMono(9)).kerning(1.6)
        }
        .foregroundStyle(Explore.onAccent)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Explore.accent, in: .capsule)
    }

    /// Glass pill over the photo. On the night itself it becomes the ember live
    /// marker with an expanding ring — the one thing ember is allowed to mean.
    private var whenPill: some View {
        HStack(spacing: 8) {
            if event.isTonight {
                PulseDot()
                Text(locale.t("events.onTonight"))
                    .font(.cfMono(10, weight: .medium)).kerning(1.4)
                    .foregroundStyle(.white)
                if let t = event.timeLabel {
                    Text("· \(t)")
                        .font(.cfMono(10)).kerning(1.4)
                        .foregroundStyle(Color(hex: 0xFFD9C6))
                }
            } else {
                Text([event.dayLabel(locale: locale), event.timeLabel]
                    .compactMap { $0 }.joined(separator: " · ").uppercased())
                    .font(.cfMono(10)).kerning(1.4)
                    .foregroundStyle(Explore.onPhoto)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.ultraThinMaterial, in: .capsule)
        .overlay(Capsule().stroke(Color.white.opacity(0.16), lineWidth: 1))
    }

    // ── Body sheet ────────────────────────────────────────────────────────────

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(event.displayTitle)
                .font(.cfDisplay(31, weight: .bold))
                .foregroundStyle(Explore.ink)
                .fixedSize(horizontal: false, vertical: true)

            subLine.padding(.top, 12)

            if !event.hostCredits.isEmpty {
                hostsRow.padding(.top, 16)
            }

            section(locale.t("events.lineup")) {
                if event.credits.isEmpty {
                    Text(locale.t("events.noLineup"))
                        .font(.cfSans(13))
                        .foregroundStyle(Explore.ink3)
                        .padding(.vertical, 10)
                } else {
                    lineupList
                }
            }

            if let description = event.description, !description.isEmpty {
                section(locale.t("events.about")) {
                    Text(description)
                        .font(.cfSans(13.5))
                        .foregroundStyle(Explore.ink2)
                        .lineSpacing(5)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }
            }

            section(locale.t("events.details")) { detailRows.padding(.top, 8) }
        }
        .padding(.horizontal, 20)
        .padding(.top, 22)
        .padding(.bottom, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 26, topTrailingRadius: 26)
                .fill(Explore.bg)
        )
        // The sheet rides up over the hero's lower edge; with no hero it just
        // clears the always-present bar.
        .padding(.top, event.image != nil ? -26 : 96)
    }

    /// Venue · Free entry · Room of N — the facts that decide whether to read on.
    private var subLine: some View {
        let parts = [
            event.venueName,
            event.isFree ? locale.t("events.free") : nil,
            event.totalCapacity.map { String(format: locale.t("events.roomOf"), $0) },
        ].compactMap { $0 }

        return HStack(spacing: 8) {
            ForEach(Array(parts.enumerated()), id: \.offset) { i, part in
                if i > 0 {
                    Circle().fill(Explore.ink3).frame(width: 3, height: 3)
                }
                Text(part.uppercased())
                    .font(.cfMono(10.5)).kerning(1.2)
                    .foregroundStyle(Explore.ink2)
            }
        }
    }

    /// Overlapping initial discs, then "Hosted by A × B".
    private var hostsRow: some View {
        HStack(spacing: 10) {
            HStack(spacing: -8) {
                ForEach(event.hostCredits, id: \.key) { host in
                    Text(String(host.name.prefix(1)).uppercased())
                        .font(.cfDisplay(11, weight: .bold))
                        .foregroundStyle(Explore.accent)
                        .frame(width: 26, height: 26)
                        .background(Explore.surface2, in: .circle)
                        .overlay(Circle().stroke(Explore.lineStrong, lineWidth: 1))
                }
            }
            Text(hostSentence)
                .font(.cfSans(13))
                .foregroundStyle(Explore.ink2)
                .lineLimit(2)
        }
    }

    private var hostSentence: AttributedString {
        var out = AttributedString("\(locale.t("events.hostedBy")) ")
        for (i, host) in event.hostCredits.enumerated() {
            if i > 0 {
                var sep = AttributedString(" × ")
                sep.foregroundColor = Explore.ink3
                out += sep
            }
            var name = AttributedString(host.name)
            name.foregroundColor = Explore.ink
            name.font = .cfSans(13, weight: .semibold)
            out += name
        }
        return out
    }

    /// Numbered billing. The headliner is set larger with an accent number —
    /// order carries meaning here, so the list shows it rather than flattening
    /// everyone to one weight.
    private var lineupList: some View {
        VStack(spacing: 0) {
            ForEach(Array(event.credits.enumerated()), id: \.element.key) { i, credit in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(String(format: "%02d", i + 1))
                        .font(.cfMono(10)).kerning(0.6)
                        .foregroundStyle(i == 0 ? Explore.accent : Explore.ink3)
                        .frame(width: 24, alignment: .leading)
                    Text(credit.name)
                        .font(.cfDisplay(i == 0 ? 21 : 17, weight: i == 0 ? .bold : .semibold))
                        .foregroundStyle(Explore.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 11)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Explore.line).frame(height: 1)
                }
            }
        }
        .padding(.top, 6)
    }

    private var detailRows: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Explore.line).frame(height: 1)
            if let venue = event.venueName {
                detailRow(locale.t("events.where"), venue, sub: event.address)
            }
            detailRow(locale.t("events.when"),
                      event.dayLabel(locale: locale), sub: event.timeLabel)
            if event.isFree {
                detailRow(locale.t("events.entry"),
                          locale.t("events.free"), sub: locale.t("events.entryNote"))
            }
            if let capacity = event.totalCapacity, capacity > 0 {
                detailRow(locale.t("events.room"),
                          String(format: locale.t("events.roomHolds"), capacity), sub: nil)
            }
        }
    }

    private func detailRow(_ key: String, _ value: String, sub: String?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(key.uppercased())
                .font(.cfMono(9.5)).kerning(1.5)
                .foregroundStyle(Explore.ink3)
                .frame(width: 88, alignment: .leading)
                .padding(.top, 3)
            VStack(alignment: .leading, spacing: 3) {
                Text(value)
                    .font(.cfSans(13.5))
                    .foregroundStyle(Explore.ink)
                if let sub, !sub.isEmpty {
                    Text(sub)
                        .font(.cfSans(12.5))
                        .foregroundStyle(Explore.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Explore.line).frame(height: 1)
        }
    }

    private func section<Content: View>(
        _ label: String, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.cfMono(9.5)).kerning(2.1)
                .foregroundStyle(Explore.accent)
            content()
        }
        .padding(.top, 26)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // ── Chrome ────────────────────────────────────────────────────────────────

    private var collapsedBar: some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: 100)
            .background(.ultraThinMaterial)
            .overlay(alignment: .bottom) {
                Text(event.displayTitle)
                    .font(.cfDisplay(15))
                    .foregroundStyle(Explore.ink)
                    .lineLimit(1)
                    .padding(.horizontal, 66)
                    .padding(.bottom, 14)
            }
            .overlay(alignment: .bottom) {
                Rectangle().fill(Explore.line).frame(height: 1)
            }
            .ignoresSafeArea(edges: .top)
    }

    private var topControls: some View {
        HStack {
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                roundLabel("chevron.left")
            }
            Spacer()
            if let share = shareURL {
                ShareLink(item: share) { roundLabel("square.and.arrow.up") }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
    }

    private var shareURL: URL? {
        URL(string: "https://clubfuoco.com/events/\(event.id)")
    }

    private func roundLabel(_ icon: String) -> some View {
        Image(systemName: icon)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(barShown ? Explore.ink : Explore.onPhoto)
            .frame(width: 38, height: 38)
            .background(.ultraThinMaterial, in: .circle)
            .overlay(Circle().stroke(Color.white.opacity(barShown ? 0 : 0.16), lineWidth: 1))
    }

    // ── Dock ──────────────────────────────────────────────────────────────────

    @ViewBuilder private var dock: some View {
        // Hidden entirely where a reservation is impossible: `bookings.club_id`
        // is NOT NULL, so a night at a free-text address has nothing to book
        // against, and a button that always errors is worse than none.
        if event.clubId != nil {
            VStack(spacing: 0) {
                if let errorText {
                    Text(errorText)
                        .font(.cfSans(12))
                        .foregroundStyle(Explore.ember)
                        .multilineTextAlignment(.center)
                        .padding(.bottom, 8)
                }

                dockButton

                if state == .reserved {
                    HStack(spacing: 14) {
                        Button {
                            Haptics.tap()
                            showPass = true
                        } label: {
                            Text(locale.t("events.viewPass"))
                                .font(.cfMono(9.5)).kerning(1.4)
                                .foregroundStyle(Explore.accent)
                        }
                        Rectangle().fill(Explore.lineStrong).frame(width: 1, height: 11)
                        Button {
                            showCancelConfirm = true
                        } label: {
                            Text(locale.t("events.cancelRsvp"))
                                .font(.cfMono(9.5)).kerning(1.4)
                                .foregroundStyle(Explore.ink3)
                        }
                    }
                    .padding(.top, 11)
                } else {
                    Text(dockNote)
                        .font(.cfMono(9.5)).kerning(1.1)
                        .foregroundStyle(Explore.ink3)
                        .multilineTextAlignment(.center)
                        .padding(.top, 10)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)
            .background(.ultraThinMaterial)
            .overlay(alignment: .top) {
                Rectangle().fill(Explore.line).frame(height: 1)
            }
        }
    }

    @ViewBuilder private var dockButton: some View {
        switch state {
        case .working:
            dockShell(fill: Explore.accent, stroke: nil, text: Explore.onAccent) {
                HStack(spacing: 9) {
                    ProgressView().tint(Explore.onAccent)
                    Text(locale.t("events.reserving"))
                }
            }
            .opacity(0.72)

        case .reserved:
            // Tapping the settled button gives the spot up — behind a
            // confirmation, because it is the same control that a moment ago
            // meant "reserve" and a mis-tap would silently drop them off the
            // door list.
            Button { showCancelConfirm = true } label: {
                dockShell(fill: Explore.accentSoft, stroke: Explore.accentDim, text: Explore.ink) {
                    HStack(spacing: 9) {
                        Image(systemName: "checkmark").font(.system(size: 14, weight: .bold))
                        Text(locale.t("events.reserved"))
                    }
                }
            }

        case .full:
            dockShell(fill: Explore.surface2, stroke: Explore.lineStrong, text: Explore.ink3) {
                Text(locale.t("events.fullTitle"))
            }

        case .signedOut:
            Button { showGuestGate = true } label: {
                dockShell(fill: .clear, stroke: Explore.accent, text: Explore.accent) {
                    Text(locale.t("events.joinToReserve"))
                }
            }

        case .ready:
            Button { Task { await reserve() } } label: {
                dockShell(fill: Explore.accent, stroke: nil, text: Explore.onAccent) {
                    Text(locale.t("events.reserve"))
                }
            }
        }
    }

    private func dockShell<C: View>(
        fill: Color, stroke: Color?, text: Color, @ViewBuilder content: () -> C
    ) -> some View {
        content()
            .font(.cfSans(15.5, weight: .semibold))
            .foregroundStyle(text)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(fill, in: .capsule)
            .overlay {
                if let stroke { Capsule().stroke(stroke, lineWidth: 1) }
            }
    }

    private var dockNote: String {
        switch state {
        case .working:   return locale.t("events.holdingSpot")
        case .full:      return String(format: locale.t("events.fullNote"), event.totalCapacity ?? 0)
        case .signedOut: return locale.t("events.joinNote")
        default:         return locale.t("events.reserveHint")
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private struct StateResult: Decodable, Sendable {
        let reserved: Bool?
        let full: Bool?
        let bookingId: String?
        let scanToken: String?
        let reference: String?
    }

    private func loadState() async {
        // Public for the capacity answer, so this runs for guests too.
        guard let result: StateResult = try? await api.get("/api/events/\(event.id)/reserve")
        else { return }
        reserved = result.reserved ?? false
        full = result.full ?? false
        bookingId = result.bookingId
        scanToken = result.scanToken
        reference = result.reference
    }

    private func reserve() async {
        working = true
        errorText = nil
        do {
            let result: StateResult = try await api.post("/api/events/\(event.id)/reserve")
            reserved = true
            bookingId = result.bookingId
            scanToken = result.scanToken
            reference = result.reference
            Haptics.success()
            // Straight into the pass — the QR, Wallet and the calendar, the
            // same three things a paid booking offers on confirmation.
            if bookingId != nil { showPass = true }
        } catch {
            errorText = error.localizedDescription
        }
        working = false
    }

    private func cancel() async {
        working = true
        errorText = nil
        do {
            let _: StateResult = try await api.delete("/api/events/\(event.id)/reserve")
            reserved = false
            bookingId = nil; scanToken = nil; reference = nil
            Haptics.tap()
            // A spot just reopened, so the full flag may have changed too.
            await loadState()
        } catch {
            errorText = error.localizedDescription
        }
        working = false
    }
}

/// The ember live dot with its expanding ring — `.ev-dot::after` on the
/// artboard. Only ever used for "on tonight".
private struct PulseDot: View {
    @State private var animating = false

    var body: some View {
        Circle()
            .fill(Explore.ember)
            .frame(width: 7, height: 7)
            .overlay {
                Circle()
                    .stroke(Explore.ember, lineWidth: 1.5)
                    .padding(-4)
                    .scaleEffect(animating ? 1.35 : 0.55)
                    .opacity(animating ? 0 : 0.75)
                    .animation(.easeOut(duration: 1.8).repeatForever(autoreverses: false),
                               value: animating)
            }
            .onAppear { animating = true }
    }
}
