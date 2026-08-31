import SwiftUI
import CoreLocation
import UIKit

/// Disables the ~150ms content-touch delay on the ENCLOSING scroll view only,
/// so buttons in the feed (When planner pill, chips, save) respond on the first
/// tap. Scoped deliberately — the global `UIScrollView.appearance()` version
/// also killed the wheel Picker's own scrollers inside the When planner.
private struct ScrollTouchFix: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let v = UIView(frame: .zero)
        v.isUserInteractionEnabled = false
        DispatchQueue.main.async {
            var s = v.superview
            while let cur = s, !(cur is UIScrollView) { s = cur.superview }
            (s as? UIScrollView)?.delaysContentTouches = false
        }
        return v
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

/// The explore feed, drawn to the "Event Cards - App Front" design: location
/// line + icon buttons, search pill, the When planner wheel, filter chips, then
/// the shelf feed of a featured hero over horizontal category rails.
///
/// Colour comes from `Explore` rather than `Theme`, and adapts: the artboard's
/// dark values in dark, the same design system's light palette in light. Data
/// is unchanged — `ExploreViewModel` and `ShelfBuilder` are exactly as they
/// were, and cards still push the venue detail route.
struct ExploreView: View {
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan
    @State private var model = ExploreViewModel()
    @State private var showGuestGate = false
    @State private var showNearbyLocationSheet = false
    private static let nearbyPromptKey = "cf.nearbyPromptShown"
    #if DEBUG
    @State private var debugDetailPlace: Place?
    @State private var debugDetailRumba: Rumba?
    #endif

    /// Club ids running a live offer on the planned night. This is the only
    /// thing that earns a card the design's accented `offer` frame; every
    /// other card is plain. Either way the card taps through to the venue.
    /// Keys in `offersByClub` are lowercased, which is
    /// also how `Place.placeId` is stored.
    private var offerClubIds: Set<String> {
        Set(model.offersByClub.compactMap { clubId, offers in
            offers.contains { $0.liveOn(plan.date) } ? clubId : nil
        })
    }

    /// First-launch ask: WhenInUse so we can show clubs closest to the user.
    /// Skips guests (no booking story yet) and anyone who already decided.
    /// The Always upgrade is a separate ask, surfaced after the user actually
    /// books — see `BookNightSheet.confirmedView`.
    private func maybePromptNearby() {
        guard auth.hasAccount else { return }
        guard !UserDefaults.standard.bool(forKey: Self.nearbyPromptKey) else { return }
        guard LocationService.shared.authorizationStatus == .notDetermined else { return }
        UserDefaults.standard.set(true, forKey: Self.nearbyPromptKey)
        // Tiny delay so the first frame of the feed lands before the sheet
        // covers it — feels less like a permission-wall at app open.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            showNearbyLocationSheet = true
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Pinned top bar — stays in place while the feed scrolls beneath it.
            VStack(alignment: .leading, spacing: 0) {
                topbar
                    .padding(.init(top: 16, leading: Explore.gutter,
                                   bottom: 10, trailing: Explore.gutter))

                if model.showSearch {
                    searchField
                        .padding(.init(top: 0, leading: Explore.gutter,
                                       bottom: 12, trailing: Explore.gutter))
                }
            }
            .background(Explore.bg)
            // Hairline so the feed scrolls away beneath the fixed header,
            // reading as a separate layer rather than part of the card list.
            .overlay(alignment: .bottom) {
                Rectangle().fill(Explore.line).frame(height: 1)
            }
            .zIndex(1)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch model.state {
                    case .loading:
                        skeleton
                    case .failed(let message):
                        errorBanner(message)
                    case .loaded:
                        if model.showSearch && !model.search.isEmpty {
                            searchResults
                        } else if model.showSaved {
                            savedView
                        } else {
                            feed
                        }
                    }
                }
                .padding(.top, 8)
                .padding(.bottom, 28)
                .background(ScrollTouchFix())
            }
            .refreshable {
                await model.load(planDate: plan.date) { locale.t($0) }
            }
        }
        .background(Explore.bg)
        // NO colorScheme override here. `.environment` flows down the whole
        // subtree, and `navigationDestination` content is part of it — forcing
        // `.dark` on this view also forced it on ClubDetailView,
        // RumbaDetailView and ShelfListView. Explore is the launch tab, so
        // that removed light mode from most of the app. The palette adapts on
        // its own; the appearance is the device's to decide.
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: Place.self) { place in
            ClubDetailView(place: place)
        }
        .navigationDestination(for: Rumba.self) { rumba in
            RumbaDetailView(rumba: rumba)
        }
        .navigationDestination(for: Shelf.self) { shelf in
            ShelfListView(shelf: shelf, model: model, onSave: save)
        }
        .navigationDestination(for: FeedEvent.self) { EventDetailView(event: $0) }
        .sheet(isPresented: $showNearbyLocationSheet) {
            LocationPermissionSheet(mode: .nearby)
        }
        .task {
            model.configure(queries: auth.queries, api: api)
            // Paint the last-known feed from disk instantly, before touching the
            // network (stale-while-revalidate).
            model.hydrateFromCache(planDate: plan.date) { locale.t($0) }
            // .task re-fires every time the feed reappears (back from a club,
            // tab switch) — and a reload rebuilds the shelves, whose pool is
            // shuffled per build. Only load when we have nothing yet, so the
            // feed the user was browsing stays exactly as they left it.
            // Pull-to-refresh is the explicit way to get a fresh rotation.
            if model.places.isEmpty {
                // Cold: nothing cached — block on the load (skeleton showing).
                await model.load(planDate: plan.date) { locale.t($0) }
            } else if !model.didRefresh {
                // Warm: cache is on screen — refresh once in the background and
                // swap silently, without blocking or reshuffling on reappear.
                model.didRefresh = true
                Task { await model.load(planDate: plan.date) { locale.t($0) } }
            }
            maybePromptNearby()
            #if DEBUG
            // Simulator automation: open the first venue / rumba detail
            if ProcessInfo.processInfo.environment["CF_TEST_OPEN_FIRST_CLUB"] == "1" {
                debugDetailPlace = model.places.first
            }
            if let name = ProcessInfo.processInfo.environment["CF_TEST_OPEN_CLUB_NAME"] {
                debugDetailPlace = model.places.first { $0.name.localizedCaseInsensitiveContains(name) }
            }
            if ProcessInfo.processInfo.environment["CF_TEST_OPEN_RUMBA"] == "1" {
                debugDetailRumba = model.rumbas.first
            }
            #endif
        }
        .onChange(of: plan.date) {
            model.rebuildShelves(planDate: plan.date) { locale.t($0) }
        }
        .onChange(of: locale.locale) {
            model.rebuildShelves(planDate: plan.date) { locale.t($0) }
        }
        #if DEBUG
        .fullScreenCover(item: $debugDetailPlace) { place in
            NavigationStack { ClubDetailView(place: place) }
        }
        .fullScreenCover(item: $debugDetailRumba) { rumba in
            NavigationStack { RumbaDetailView(rumba: rumba) }
        }
        #endif
        .sheet(isPresented: $showGuestGate) {
            GuestGateView(reason: .save)
                .presentationDetents([.medium])
        }
    }

    // ── Top bar (.topbar) ─────────────────────────────────────────────────────

    /// Location line + controls. The design replaces the old "fuoco." wordmark
    /// with a live location/night line, which doubles as a readout of what the
    /// When planner below is set to.
    private var topbar: some View {
        HStack(alignment: .center) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Explore.accent)
                    .frame(width: 6, height: 6)
                    // `.dotc` — the gold dot carries a soft 3px halo.
                    .overlay(Circle().stroke(Explore.accentSoft, lineWidth: 3))
                Text(locale.t("explore.city"))
                    .font(.cfSans(13, weight: .semibold))
                    .foregroundStyle(Explore.ink)
                Text("· \(plan.nightPhrase(locale: locale))")
                    .font(.cfSans(13))
                    .foregroundStyle(Explore.ink2)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            HStack(spacing: 8) {
                iconButton(
                    icon: model.showSearch ? "xmark" : "magnifyingglass",
                    active: model.showSearch
                ) {
                    withAnimation { model.showSearch.toggle(); model.showSaved = false }
                }

                NavigationLink {
                    FiammeView()
                } label: {
                    Text(locale.t("explore.points").uppercased())
                        .font(.cfMono(10, weight: .medium))
                        .kerning(0.8)
                        .foregroundStyle(Explore.ink2)
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .background(Explore.surface2, in: .capsule)
                        .overlay(Capsule().stroke(Explore.line, lineWidth: 1))
                }

                iconButton(
                    icon: model.showSaved ? "bookmark.fill" : "bookmark",
                    active: model.showSaved
                ) {
                    withAnimation { model.showSaved.toggle(); model.showSearch = false; model.search = "" }
                }
            }
        }
    }

    /// `.icon-btn` — 34pt circle, surface-2 fill, hairline ring. Active flips
    /// to the gold fill the chips use, so "search on" and "chip on" read the
    /// same way.
    private func iconButton(icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(active ? Explore.onAccent : Explore.ink2)
                .frame(width: 34, height: 34)
                .background(active ? Explore.accent : Explore.surface2, in: .circle)
                .overlay(Circle().stroke(active ? .clear : Explore.line, lineWidth: 1))
        }
    }

    /// `.search` — a pill, not the cream feed's rounded rect.
    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(Explore.ink3)
            TextField(
                "",
                text: Bindable(model).search,
                prompt: Text(locale.t("explore.searchPlaceholder"))
                    .font(.cfSans(13.5))
                    .foregroundStyle(Explore.ink3)
            )
            .font(.cfSans(13.5))
            .foregroundStyle(Explore.ink)
            .tint(Explore.accent)
            .autocorrectionDisabled()
            .submitLabel(.search)
            if !model.search.isEmpty {
                Button {
                    Haptics.tap()
                    withAnimation(.easeOut(duration: 0.15)) { model.search = "" }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Explore.ink3)
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .scale))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Explore.surface, in: .capsule)
        .overlay(Capsule().stroke(Explore.line, lineWidth: 1))
    }

    // ── Feed ──────────────────────────────────────────────────────────────────

    private var feed: some View {
        let shelves = model.shelves

        return VStack(alignment: .leading, spacing: 0) {
            // The day wheel. It sits directly under the header, above the
            // chips, because `plan.date` is the input the whole feed ranks on:
            // ShelfBuilder tiers venues by whether an offer is live on the
            // planned night, and the featured section header prints it.
            WhenPlannerView()
                .padding(.top, 10)

            filterChips
                .padding(.top, 14)

            // ── Tier 1: the pinned event ─────────────────────────────────────
            // The very top of the feed, above every venue shelf. This is the
            // slot the portal's pin control chooses, and an event outranks a
            // venue here by design: a venue is somewhere you could go, an
            // event is something that is actually happening.
            if let hero = model.heroEvent {
                NavigationLink(value: hero) {
                    EventHeroCard(event: hero)
                        .padding(.horizontal, Explore.gutter)
                        .padding(.top, 20)
                }
                .buttonStyle(.plain)
            }

            if !model.railEvents.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    SectionHead(
                        subtitle: locale.t("events.kicker"),
                        title: locale.t("events.more")
                    ) { EmptyView() }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(model.railEvents) { event in
                                NavigationLink(value: event) { EventCard(event: event) }
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, Explore.gutter)
                        .padding(.bottom, 6)
                    }
                }
                .padding(.top, 22)
            }

            // Guest-list events strip — HIDDEN. We have no booking agreements
            // with the venues currently in the `rumbas` table, so the strip is
            // suppressed in the feed to avoid offering guest lists we can't
            // honor. Re-enable once real venue agreements exist (the rumba
            // data + signup flow remain intact behind this gate).
            let showGuestLists = false
            if showGuestLists && !model.rumbas.isEmpty {
                rumbaShelf
            }

            if shelves.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "location.magnifyingglass")
                        .font(.system(size: 40))
                        .foregroundStyle(Explore.ink3.opacity(0.5))
                    Text(locale.t("explore.noneNearby"))
                        .font(.cfSans(14))
                        .foregroundStyle(Explore.ink2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
            } else {
                ForEach(shelves) { shelf in
                    ShelfRowView(
                        shelf: shelf,
                        saved: model.saved,
                        offerClubIds: offerClubIds,
                        onSave: save
                    )
                }
            }
        }
    }

    /// `.filterbar` — gold when active, surface-2 with a hairline otherwise.
    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(ShelfBuilder.filterChips, id: \.id) { chip in
                    let active = model.activeFilter == chip.id
                    Button {
                        model.activeFilter = chip.id
                        model.rebuildShelves(planDate: plan.date) { locale.t($0) }
                        Haptics.tap()
                    } label: {
                        Text(locale.t(chip.labelKey))
                            .font(.cfSans(12.5, weight: active ? .semibold : .medium))
                            .foregroundStyle(active ? Explore.onAccent : Explore.ink2)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(active ? Explore.accent : Explore.surface2, in: .capsule)
                            .overlay(Capsule().stroke(active ? .clear : Explore.line, lineWidth: 1))
                    }
                }
            }
            .padding(.horizontal, Explore.gutter)
        }
    }

    private func save(_ place: Place) {
        if !model.toggleSave(place, isSignedIn: auth.hasAccount) {
            showGuestGate = true
        }
    }

    // ── Rumbas strip ──────────────────────────────────────────────────────────

    private var rumbaShelf: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(subtitle: locale.t("shelf.rumbas.sub"),
                        title: locale.t("shelf.rumbas.title")) {
                Text(String(format: locale.t("explore.eventsArrow"), model.rumbas.count))
                    .font(.cfSans(12.5, weight: .semibold))
                    .foregroundStyle(Explore.accent)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(model.rumbas) { rumba in
                        NavigationLink(value: rumba) {
                            rumbaCard(rumba)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, Explore.gutter)
            }
        }
        .padding(.top, 22)
    }

    private func rumbaCard(_ rumba: Rumba) -> some View {
        ZStack(alignment: .bottomLeading) {
            Explore.photoPlaceholder
                .overlay {
                    if let url = rumba.coverImage.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Explore.photoPlaceholder }
                    }
                }
                .overlay { GrainOverlay() }
                .overlay(
                    LinearGradient(colors: [.black.opacity(0.75), .clear],
                                   startPoint: .bottom, endPoint: .top)
                )
                .frame(width: 220, height: 130)
                .clipped()

            // Over a photo — fixed light ink, never the adaptive pair.
            VStack(alignment: .leading, spacing: 2) {
                Text("RUMBA")
                    .font(.cfMono(9))
                    .kerning(1.2)
                    .foregroundStyle(Explore.onPhoto)
                Text(rumba.title)
                    .font(.cfDisplay(14))
                    .foregroundStyle(Explore.onPhoto)
                    .lineLimit(1)
                Text([rumba.venueName, String(format: locale.t("rumba.spotsLeft"), rumba.spotsLeft)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.cfSans(10))
                    .foregroundStyle(Explore.onPhotoDim)
                    .lineLimit(1)
            }
            .padding(10)
        }
        .frame(width: 220, height: 130)
        .clipShape(.rect(cornerRadius: Explore.rThumb))
        .overlay(
            RoundedRectangle(cornerRadius: Explore.rThumb)
                .stroke(Explore.lineStrong, lineWidth: 1)
        )
    }

    // ── Search results ────────────────────────────────────────────────────────

    private var searchResults: some View {
        VStack(spacing: 10) {
            if model.searchResults.isEmpty {
                Text(String(format: locale.t("explore.noResults"), model.search))
                    .font(.cfSans(13))
                    .foregroundStyle(Explore.ink2)
                    .padding(.vertical, 32)
            } else {
                ForEach(model.searchResults) { place in
                    NavigationLink(value: place) {
                        HStack(spacing: 12) {
                            Explore.photoPlaceholder
                                .overlay {
                                    if let url = place.coverPhoto.flatMap(URL.init(string:)) {
                                        CachedAsyncImage(url: url, targetWidth: FeedImage.thumbWidth) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Explore.photoPlaceholder }
                                    }
                                }
                                .frame(width: 52, height: 52)
                                .clipShape(.rect(cornerRadius: 10))

                            VStack(alignment: .leading, spacing: 3) {
                                Text(place.name)
                                    .font(.cfDisplay(14))
                                    .foregroundStyle(Explore.ink)
                                    .lineLimit(1)
                                Text(place.neighborhood ?? place.address)
                                    .font(.cfSans(11.5))
                                    .foregroundStyle(Explore.ink2)
                                    .lineLimit(1)
                            }
                            Spacer()
                            if place.isOpen == true {
                                Text(locale.t("explore.open").uppercased())
                                    .font(.cfMono(9))
                                    .kerning(1)
                                    .foregroundStyle(Explore.ember)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(.black.opacity(0.5), in: .capsule)
                                    .overlay(Capsule().stroke(Explore.ember.opacity(0.5), lineWidth: 1))
                            }
                        }
                        .padding(12)
                        .background(Explore.surface, in: .rect(cornerRadius: Explore.rCard))
                        .overlay(
                            RoundedRectangle(cornerRadius: Explore.rCard)
                                .stroke(Explore.lineStrong, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, Explore.gutter)
        .padding(.top, 14)
    }

    // ── Saved view ────────────────────────────────────────────────────────────

    private var savedView: some View {
        let savedPlaces = model.savedPlaces
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text(locale.t("explore.savedTitle"))
                    .font(.cfDisplay(30, weight: .bold))
                    .foregroundStyle(Explore.ink)
                Text(savedPlaces.isEmpty
                     ? locale.t("explore.noSaved")
                     : savedPlaces.count == 1
                        ? locale.t("explore.savedOne")
                        : String(format: locale.t("explore.savedMany"), savedPlaces.count))
                    .font(.cfMono(10.5))
                    .kerning(0.8)
                    .foregroundStyle(Explore.ink3)
            }
            .padding(.init(top: 16, leading: Explore.gutter, bottom: 20, trailing: Explore.gutter))

            if savedPlaces.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "bookmark")
                        .font(.system(size: 40))
                        .foregroundStyle(Explore.ink3.opacity(0.5))
                        .padding(.bottom, 8)
                    Text(locale.t("explore.nothingSaved"))
                        .font(.cfSans(14))
                        .foregroundStyle(Explore.ink2)
                    Text(locale.t("explore.savedHint"))
                        .font(.cfSans(12))
                        .foregroundStyle(Explore.ink3)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)
                .padding(.vertical, 48)
            } else {
                VStack(spacing: 12) {
                    ForEach(savedPlaces) { place in
                        EventRow(
                            place: place,
                            hasOffer: offerClubIds.contains(place.placeId),
                            isSaved: true
                        ) { save(place) }
                    }
                }
                .padding(.horizontal, Explore.gutter)
            }
        }
    }

    // ── Loading / error ───────────────────────────────────────────────────────

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: 26) {
            // Featured card — visible structure inside (tag + two title lines)
            // so a slow venue image load doesn't look like a giant empty box.
            ZStack(alignment: .bottomLeading) {
                ShimmerBlock(corner: Explore.rFeatured).frame(height: 300)
                VStack(alignment: .leading, spacing: 10) {
                    ShimmerBlock(corner: 4).frame(width: 120, height: 11)
                    ShimmerBlock(corner: 4).frame(width: 200, height: 26)
                    ShimmerBlock(corner: 4).frame(width: 150, height: 14)
                }
                .padding(18)
            }
            // Rails — horizontal ScrollView (like the loaded feed) so the
            // fixed-width cards clip at the screen edge instead of widening
            // the whole skeleton past it.
            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 14) {
                    ShimmerBlock(corner: 4).frame(width: 140, height: 12)
                    ScrollView(.horizontal) {
                        HStack(spacing: 12) {
                            ForEach(0..<3, id: \.self) { _ in
                                ShimmerBlock(corner: Explore.rFeed).frame(width: 164, height: 220)
                            }
                        }
                    }
                    .scrollDisabled(true)
                }
            }
        }
        .padding(.horizontal, Explore.gutter)
        .padding(.top, 14)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(Explore.ember)
            Text(locale.t("explore.loadError"))
                .font(.cfSans(13))
                .foregroundStyle(Explore.ink2)
            Spacer()
            Button(locale.t("common.retry")) {
                Task { await model.load(planDate: plan.date) { locale.t($0) } }
            }
            .font(.cfSans(13, weight: .semibold))
            .foregroundStyle(Explore.accent)
        }
        .padding(14)
        .background(Explore.surface, in: .rect(cornerRadius: Explore.rCard))
        .overlay(
            RoundedRectangle(cornerRadius: Explore.rCard)
                .stroke(Explore.ember.opacity(0.35), lineWidth: 1)
        )
        .padding(.horizontal, Explore.gutter)
        .padding(.top, 14)
    }
}
