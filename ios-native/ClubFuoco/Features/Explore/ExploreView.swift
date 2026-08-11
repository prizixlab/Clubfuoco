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

/// Native port of the explore feed: header with wordmark + search/saved
/// toggles, WhenPlanner, filter chips, and the shelf feed. Cards navigate to
/// the venue detail screen via NavigationLink(value: Place).
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

    /// First-launch ask: WhenInUse so we can show clubs closest to the user.
    /// Skips guests (no booking story yet) and anyone who already decided.
    /// The Always upgrade is a separate ask, surfaced after the user actually
    /// books — see `BookNightSheet.confirmedView`.
    private func maybePromptNearby() {
        guard auth.state == .signedIn, !auth.guestMode else { return }
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
                header
                    .padding(.init(top: 8, leading: 20, bottom: model.showSearch ? 16 : 14, trailing: 20))

                if model.showSearch {
                    searchField
                        .padding(.init(top: 0, leading: 20, bottom: 16, trailing: 20))
                }
            }
            .background(Theme.cream)
            // Hairline + soft shadow so the When planner (and feed) scroll away
            // beneath the fixed header, reading as a separate layer rather than
            // part of the card list.
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.hairline).frame(height: 1)
            }
            .shadow(color: Theme.ink.opacity(0.06), radius: 8, y: 4)
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
                .padding(.top, 16)
                .background(ScrollTouchFix())
            }
            .refreshable {
                await model.load(planDate: plan.date) { locale.t($0) }
            }
        }
        .background(Theme.cream)
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
            GuestGateView()
                .presentationDetents([.medium])
        }
    }

    // ── Header ────────────────────────────────────────────────────────────────

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text("fuoco.")
                    .font(.cfSerif(28, italic: true))
                    .foregroundStyle(Theme.ink)
                Text(locale.t("explore.subtitle"))
                    .font(.cfSans(10))
                    .kerning(0.8)
                    .foregroundStyle(Theme.fadedSand)
            }

            Spacer()

            HStack(spacing: 8) {
                roundButton(
                    icon: model.showSearch ? "xmark" : "magnifyingglass",
                    active: model.showSearch
                ) {
                    withAnimation { model.showSearch.toggle(); model.showSaved = false }
                }

                NavigationLink {
                    FiammeView()
                } label: {
                    Text(locale.t("explore.points").uppercased())
                        .font(.cfSans(11, weight: .semibold))
                        .kerning(0.5)
                        .foregroundStyle(Theme.stone)
                        .padding(.horizontal, 13)
                        .frame(height: 36)
                        .background(Theme.ink.opacity(0.05), in: .capsule)
                }

                roundButton(
                    icon: model.showSaved ? "bookmark.fill" : "bookmark",
                    active: model.showSaved
                ) {
                    withAnimation { model.showSaved.toggle(); model.showSearch = false; model.search = "" }
                }
            }
        }
    }

    private func roundButton(icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(active ? Theme.cream : Theme.stone)
                .frame(width: 36, height: 36)
                .background(active ? Theme.ink : Theme.ink.opacity(0.05), in: .circle)
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.stone)
            TextField(locale.t("explore.searchPlaceholder"), text: Bindable(model).search)
                .font(.cfSans(16))
                .foregroundStyle(Theme.ink)
                .tint(Theme.ember)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !model.search.isEmpty {
                Button {
                    Haptics.tap()
                    withAnimation(.easeOut(duration: 0.15)) { model.search = "" }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.sand)
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .scale))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 50)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.ink.opacity(0.06), lineWidth: 1))
        .shadow(color: Theme.ink.opacity(0.06), radius: 12, y: 4)
    }

    // ── Feed ──────────────────────────────────────────────────────────────────

    private var feed: some View {
        let shelves = model.shelves

        return VStack(alignment: .leading, spacing: 0) {
            WhenPlannerView()
                .padding(.bottom, 16)

            if let first = shelves.first, first.featured {
                ShelfRowView(shelf: first, index: 0, saved: model.saved, onSave: save)
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

            // Filter chips
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
                                .font(.cfSans(13, weight: active ? .semibold : .regular))
                                .foregroundStyle(active ? Theme.cream : Theme.stone)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 7)
                                .background(active ? Theme.ink : Theme.ink.opacity(0.05), in: .capsule)
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 16)

            if shelves.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "location.magnifyingglass")
                        .font(.system(size: 40))
                        .foregroundStyle(Theme.fadedSand.opacity(0.4))
                    Text(locale.t("explore.noneNearby"))
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.fadedSand)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
            } else {
                ForEach(Array(shelves.enumerated()), id: \.element.id) { i, shelf in
                    if !(i == 0 && shelf.featured) {
                        ShelfRowView(shelf: shelf, index: i, saved: model.saved, onSave: save)
                    }
                }
            }
        }
    }

    private func save(_ place: Place) {
        if !model.toggleSave(place, isSignedIn: auth.user != nil) {
            showGuestGate = true
        }
    }

    // ── Rumbas strip ──────────────────────────────────────────────────────────

    private var rumbaShelf: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(locale.t("shelf.rumbas.sub").uppercased())
                    .font(.cfSans(9))
                    .kerning(1.3)
                    .foregroundStyle(Theme.fadedSand)
                HStack(alignment: .firstTextBaseline) {
                    Text(locale.t("shelf.rumbas.title"))
                        .font(.cfSans(18, weight: .medium))
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    Text(String(format: locale.t("explore.eventsArrow"), model.rumbas.count))
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(model.rumbas) { rumba in
                        NavigationLink(value: rumba) {
                            rumbaCard(rumba)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.bottom, 24)
    }

    private func rumbaCard(_ rumba: Rumba) -> some View {
        ZStack(alignment: .bottomLeading) {
            Color(hex: 0x1A1410)
                .overlay {
                    if let url = rumba.coverImage.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0x1A1410) }
                    }
                }
                .frame(width: 220, height: 130)
                .clipped()
                .overlay(
                    LinearGradient(colors: [.black.opacity(0.75), .clear], startPoint: .bottom, endPoint: .top)
                )

            VStack(alignment: .leading, spacing: 1) {
                Kicker("RUMBA", color: Theme.flame, size: 8)
                Text(rumba.title)
                    .font(.cfSans(13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text([rumba.venueName, String(format: locale.t("rumba.spotsLeft"), rumba.spotsLeft)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.cfSans(10))
                    .foregroundStyle(.white.opacity(0.6))
                    .lineLimit(1)
            }
            .padding(10)
        }
        .frame(width: 220, height: 130)
        .clipShape(.rect(cornerRadius: 12))
    }

    // ── Search results ────────────────────────────────────────────────────────

    private var searchResults: some View {
        VStack(spacing: 10) {
            if model.searchResults.isEmpty {
                Text(String(format: locale.t("explore.noResults"), model.search))
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)
                    .padding(.vertical, 32)
            } else {
                ForEach(model.searchResults) { place in
                    NavigationLink(value: place) {
                        HStack(spacing: 12) {
                            Theme.imagePlaceholder
                                .overlay {
                                    if let url = place.coverPhoto.flatMap(URL.init(string:)) {
                                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Theme.imagePlaceholder }
                                    }
                                }
                                .frame(width: 52, height: 52)
                                .clipShape(.rect(cornerRadius: 10))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(place.name)
                                    .font(.cfSans(14, weight: .semibold))
                                    .foregroundStyle(Theme.ink)
                                    .lineLimit(1)
                                Text(place.address)
                                    .font(.cfSans(12))
                                    .foregroundStyle(Theme.fadedSand)
                                    .lineLimit(1)
                            }
                            Spacer()
                            if place.isOpen == true {
                                Text(locale.t("explore.open").uppercased())
                                    .font(.cfSans(8, weight: .semibold))
                                    .kerning(1)
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(Theme.success, in: .capsule)
                            }
                        }
                        .padding(12)
                        .background(Theme.surface, in: .rect(cornerRadius: 12))
                        .shadow(color: Color(hex: 0x221E1A).opacity(0.05), radius: 6, y: 3)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
    }

    // ── Saved view ────────────────────────────────────────────────────────────

    private var savedView: some View {
        let savedPlaces = model.savedPlaces
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(locale.t("explore.savedTitle"))
                    .font(.cfSerif(44, italic: true))
                    .foregroundStyle(Theme.ink)
                Text(savedPlaces.isEmpty
                     ? locale.t("explore.noSaved")
                     : savedPlaces.count == 1
                        ? locale.t("explore.savedOne")
                        : String(format: locale.t("explore.savedMany"), savedPlaces.count))
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)
            }
            .padding(.init(top: 4, leading: 20, bottom: 20, trailing: 20))

            if savedPlaces.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "bookmark")
                        .font(.system(size: 42))
                        .foregroundStyle(Theme.fadedSand.opacity(0.3))
                        .padding(.bottom, 8)
                    Text(locale.t("explore.nothingSaved"))
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.fadedSand)
                    Text(locale.t("explore.savedHint"))
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.fadedSand.opacity(0.7))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
            } else {
                VStack(spacing: 16) {
                    ForEach(savedPlaces) { place in
                        savedCard(place)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
    }

    private func savedCard(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                CardPhotoLarge(url: place.coverPhoto)
                Button {
                    save(place)
                } label: {
                    Image(systemName: "bookmark.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(.black.opacity(0.45), in: .circle)
                }
                .padding(12)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(place.name)
                    .font(.cfSerif(30))
                    .foregroundStyle(Theme.ink)
                Text(place.address)
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)

                NavigationLink(value: place) {
                    HStack(spacing: 8) {
                        Text(locale.t("explore.viewClub"))
                            .font(.cfSans(13, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(Theme.ink, in: .rect(cornerRadius: 12))
                    .foregroundStyle(Theme.cream)
                }
                .padding(.top, 10)
            }
            .padding(.init(top: 18, leading: 20, bottom: 20, trailing: 20))
        }
        .background(Theme.surface)
        .clipShape(.rect(cornerRadius: Theme.radiusCard))
        .shadow(color: Color(hex: 0x221E1A).opacity(0.08), radius: 14, y: 10)
    }

    // ── Loading / error ───────────────────────────────────────────────────────

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: 28) {
            // Hero card — visible structure inside (kicker + two title lines)
            // so a slow venue image load doesn't look like a giant empty box.
            ZStack(alignment: .bottomLeading) {
                ShimmerBlock(corner: 16).frame(height: 220)
                VStack(alignment: .leading, spacing: 10) {
                    ShimmerBlock(corner: 4).frame(width: 80, height: 10)
                    ShimmerBlock(corner: 4).frame(width: 220, height: 22)
                    ShimmerBlock(corner: 4).frame(width: 160, height: 18)
                }
                .padding(16)
            }
            // Shelves — horizontal ScrollView (like the loaded feed) so the
            // fixed-width cards clip at the screen edge instead of widening
            // the whole skeleton past it.
            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 14) {
                    ShimmerBlock(corner: 4).frame(width: 140, height: 12)
                    ScrollView(.horizontal) {
                        HStack(spacing: 12) {
                            ForEach(0..<3, id: \.self) { _ in
                                ShimmerBlock(corner: 14).frame(width: 160, height: 200)
                            }
                        }
                    }
                    .scrollDisabled(true)
                }
            }
        }
        .padding(.horizontal, 20)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(Theme.wine)
            Text(locale.t("explore.loadError"))
                .font(.cfSans(13))
                .foregroundStyle(Theme.stone)
            Spacer()
            Button(locale.t("common.retry")) {
                Task { await model.load(planDate: plan.date) { locale.t($0) } }
            }
            .font(.cfSans(13, weight: .medium))
            .foregroundStyle(Theme.wine)
        }
        .padding(14)
        .background(Theme.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.wine.opacity(0.2)))
        .padding(.horizontal, 20)
    }
}

private struct CardPhotoLarge: View {
    let url: String?

    var body: some View {
        Theme.imagePlaceholder
            .overlay {
                if let url, let parsed = URL(string: url) {
                    CachedAsyncImage(url: parsed) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Theme.imagePlaceholder }
                }
            }
            .frame(height: 200)
            .clipped()
    }
}
