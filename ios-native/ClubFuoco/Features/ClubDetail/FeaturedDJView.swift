import SwiftUI

// Featured DJ — the "this slot is a DJ, not an event" treatment on a club page.
// The club page is a light "cinema" sheet, so this matches that palette (cream
// card, ink text, gold accents) and sets itself apart from the plain event cards
// with a gold-tinted border + play button. Tapping opens a sheet with the DJ's
// info and a real SoundCloud preview (their embed is the only free, ToS-compliant
// way to play SoundCloud), which plays whatever is on the DJ's profile.

// MARK: - SoundCloud URL helper

private func canonicalSoundCloud(_ raw: String?) -> URL? {
    guard var s = raw?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
    // RA stores "https://www.soundcloud.com/kink"; the widget resolver wants the
    // canonical "https://soundcloud.com/kink".
    s = s.replacingOccurrences(of: "://www.soundcloud.com", with: "://soundcloud.com")
    return URL(string: s)
}

// MARK: - Collapsed box

struct FeaturedDJBox: View {
    let dj: FeaturedDJ
    /// Opens the detail sheet; `autoplay` true when the gold button was tapped.
    let onOpen: (_ autoplay: Bool) -> Void

    var body: some View {
        Button { Haptics.tap(); onOpen(false) } label: {
            HStack(spacing: 14) {
                photo
                VStack(alignment: .leading, spacing: 5) {
                    Text(dj.isGuest ? "SPECIAL GUEST" : "FEATURED DJ")
                        .font(.cfMono(9, weight: .medium)).kerning(1.4)
                        .foregroundStyle(Theme.gold)
                    Text(dj.name)
                        .font(.cfSerif(22))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if !dj.genres.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(dj.genres.prefix(2), id: \.self) { g in
                                Text(g.uppercased())
                                    .font(.cfMono(9)).kerning(0.8)
                                    .foregroundStyle(Theme.stone)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .overlay(RoundedRectangle(cornerRadius: 5)
                                        .stroke(Theme.fadedSand.opacity(0.45)))
                            }
                        }
                    }
                    if let line = dj.residencyLine {
                        Text(line.uppercased())
                            .font(.cfMono(10)).kerning(0.6)
                            .foregroundStyle(Theme.fadedSand)
                    }
                }
                Spacer(minLength: 8)
                HStack(spacing: 10) {
                    PlayGlyph(diameter: 40) { Haptics.tap(); onOpen(true) }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.fadedSand.opacity(0.7))
                }
            }
            .padding(16)
            .background(Theme.gold.opacity(0.07), in: .rect(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.gold.opacity(0.45)))
        }
        .buttonStyle(.plain)
    }

    private var photo: some View {
        Group {
            if let raw = dj.imageUrl, let url = URL(string: raw) {
                CachedAsyncImage(url: url, targetWidth: 128) {
                    $0.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.cream }
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(Theme.fadedSand)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.cream)
            }
        }
        .frame(width: 64, height: 64)
        .clipShape(.circle)
        .overlay(Circle().stroke(Theme.gold.opacity(0.5)))
    }
}

/// Gold circular play button (white glyph).
private struct PlayGlyph: View {
    let diameter: CGFloat
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "play.fill")
                .font(.system(size: diameter * 0.36))
                .foregroundStyle(.white)
                .offset(x: diameter * 0.03)
                .frame(width: diameter, height: diameter)
                .background(Theme.gold, in: .circle)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Expanded sheet

struct FeaturedDJSheet: View {
    let dj: FeaturedDJ
    let autoplay: Bool
    let bookable: Bool
    let onBook: (() -> Void)?
    /// Called with a `clubs.id` when the user taps a dated gig at one of our
    /// venues; the presenter dismisses this sheet and pushes that club page.
    var onOpenVenue: ((String) -> Void)? = nil
    /// The club page this sheet was opened from — a gig at that same club is
    /// shown but not tappable (there's nowhere to navigate to).
    var currentClubId: String? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(DJPlayer.self) private var djPlayer
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @State private var opened = false
    @State private var gigs: [DJGig] = []
    @State private var gigsLoaded = false
    /// The away-night row currently showing its "coming soon" line, if any.
    @State private var comingSoonGigId: String?

    private var soundcloudURL: URL? { canonicalSoundCloud(dj.soundcloud) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                hero
                playerSection
                if let bio = dj.bio, !bio.isEmpty { section("BIO") { paragraph(bio) } }
                if let line = dj.residencyLine {
                    section("WHEN THEY PLAY HERE") {
                        Text(line).font(.cfSans(15)).foregroundStyle(Theme.ink)
                    }
                }
                if !dj.knownVenues.isEmpty {
                    section("ALSO PLAYS AT") { venueChips }
                }
                scheduleSection
                socialRow
                if bookable, let onBook {
                    Button { Haptics.tap(); dismiss(); onBook() } label: {
                        Text("JOIN THE GUESTLIST"
                             + (dj.night.map { " · \($0.uppercased())" } ?? ""))
                            .font(.cfMono(11, weight: .medium)).kerning(0.8)
                            .foregroundStyle(Theme.gold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .overlay(RoundedRectangle(cornerRadius: 12)
                                .stroke(Theme.gold.opacity(0.6)))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(20)
            .padding(.bottom, 20)
        }
        .background(Theme.surface.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .overlay(alignment: .topTrailing) { closeButton }
        .task {
            // Guests (synthetic "guest:" ids) aren't in the RA catalogue, so they
            // have no scraped timeline — skip the query for them.
            guard !dj.isGuest else { gigsLoaded = true; return }
            gigs = (try? await auth.queries.djSchedule(raArtistId: dj.raArtistId)) ?? []
            gigsLoaded = true
        }
        .onAppear {
            guard !opened, soundcloudURL != nil else { return }
            opened = true
            djPlayer.open(dj, autoplay: autoplay)
        }
        // The player is a sample, not a background service — tear it down when
        // the sheet closes so audio never follows the user to other pages.
        .onDisappear { djPlayer.close() }
    }

    // Hero: photo + name + origin + genres
    private var hero: some View {
        HStack(alignment: .top, spacing: 16) {
            Group {
                if let raw = dj.imageUrl, let url = URL(string: raw) {
                    CachedAsyncImage(url: url, targetWidth: 220) {
                        $0.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: { Theme.cream }
                } else {
                    Image(systemName: "person.fill")
                        .font(.system(size: 32)).foregroundStyle(Theme.fadedSand)
                        .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.cream)
                }
            }
            .frame(width: 88, height: 88)
            .clipShape(.rect(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.gold.opacity(0.4)))

            VStack(alignment: .leading, spacing: 8) {
                Text(dj.name).font(.cfSerif(30)).foregroundStyle(Theme.ink).lineLimit(2)
                if let origin = dj.origin {
                    Text(origin.uppercased())
                        .font(.cfMono(10)).kerning(0.8).foregroundStyle(Theme.fadedSand)
                }
                if !dj.genres.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(dj.genres.prefix(3), id: \.self) { g in
                            Text(g.uppercased())
                                .font(.cfMono(9)).kerning(0.8).foregroundStyle(Theme.stone)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .overlay(RoundedRectangle(cornerRadius: 5)
                                    .stroke(Theme.fadedSand.opacity(0.45)))
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 28)
    }

    // Our own gold player (drives the shared, hidden SoundCloud widget), or a
    // graceful fallback when the DJ has no SoundCloud profile.
    @ViewBuilder private var playerSection: some View {
        if soundcloudURL != nil {
            DJPlayerControl()
        } else {
            // No preview to play — the schedule section below carries the
            // Resident Advisor link, so this box stays a simple note.
            Text("No preview available for this DJ")
                .font(.cfMono(11)).foregroundStyle(Theme.fadedSand)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 22)
                .background(Theme.cream, in: .rect(cornerRadius: 14))
        }
    }

    private var venueChips: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(dj.knownVenues.prefix(6), id: \.self) { v in
                Text(v)
                    .font(.cfMono(10)).foregroundStyle(Theme.stone)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .overlay(Capsule().stroke(Theme.fadedSand.opacity(0.4)))
            }
        }
    }

    // The DJ's own upcoming run, held internally — every city they play, not
    // just the ones we operate in. There is deliberately NO link out to Resident
    // Advisor: a night we can't sell is still ours to show.
    @ViewBuilder private var scheduleSection: some View {
        if !gigs.isEmpty {
            section("SCHEDULE") {
                VStack(spacing: 8) {
                    ForEach(gigs) { gigRow($0) }
                }
            }
        }
    }

    // One dated appearance. A venue we carry opens the club page; a city we have
    // not launched reveals a "coming soon" line in place of a dead end.
    private func gigRow(_ gig: DJGig) -> some View {
        // Not tappable when it's the club we're already on — nowhere to go.
        let opensClub = gig.isBookable && gig.clubId != currentClubId && onOpenVenue != nil
        let revealsCity = !gig.isBookable
        let showingCity = comingSoonGigId == gig.id

        return VStack(alignment: .leading, spacing: 0) {
            Button {
                if let cid = gig.clubId, opensClub {
                    Haptics.tap()
                    onOpenVenue?(cid)
                } else if revealsCity {
                    Haptics.tap()
                    withAnimation(.easeInOut(duration: 0.18)) {
                        comingSoonGigId = showingCity ? nil : gig.id
                    }
                }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(gig.displayDate)
                            .font(.cfSans(14, weight: .semibold)).foregroundStyle(Theme.ink)
                        if let venue = gig.venueName, !venue.isEmpty {
                            Text(venue).font(.cfSans(12)).foregroundStyle(Theme.stone).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    // The city is the useful signal on an away night; on a home
                    // night the venue line already says where.
                    if !gig.isBookable, let city = gig.city, !city.isEmpty {
                        Text(city.uppercased())
                            .font(.cfMono(9)).kerning(0.8)
                            .foregroundStyle(Theme.fadedSand)
                            .lineLimit(1)
                    }
                    if opensClub {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.fadedSand)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 11).padding(.horizontal, 14)
            }
            .buttonStyle(.plain)
            .disabled(!opensClub && !revealsCity)

            if showingCity {
                Text(String(format: locale.t("dj.cityComingSoon"), gig.placeLabel))
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.stone)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 11)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.fadedSand.opacity(0.3)))
    }

    private var socialRow: some View {
        HStack(spacing: 10) {
            if let ig = normalizedURL(dj.instagram, host: "instagram.com") {
                socialButton("INSTAGRAM") { openURL(ig) }
            }
            if let sc = soundcloudURL {
                socialButton("SOUNDCLOUD") { openURL(sc) }
            }
        }
    }

    private func socialButton(_ title: String, _ run: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); run() } label: {
            Text(title)
                .font(.cfMono(10, weight: .medium)).kerning(0.8)
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity).padding(.vertical, 10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.fadedSand.opacity(0.4)))
        }
        .buttonStyle(.plain)
    }

    private var closeButton: some View {
        Button { dismiss() } label: {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.stone)
                .frame(width: 32, height: 32)
                .background(Theme.cream, in: .circle)
        }
        .buttonStyle(.plain)
        .padding(.top, 14)
        .padding(.trailing, 16)
    }

    private func section<Content: View>(_ title: String,
                                        @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.cfMono(10, weight: .medium)).kerning(1.2).foregroundStyle(Theme.gold)
            content()
        }
    }

    private func paragraph(_ text: String) -> some View {
        Text(text).font(.cfSans(14)).foregroundStyle(Theme.stone).lineSpacing(4)
    }

    /// RA stores instagram as a full URL or bare handle — normalise both.
    private func normalizedURL(_ raw: String?, host: String) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if raw.hasPrefix("http"), let u = URL(string: raw) { return u }
        return URL(string: "https://\(host)/\(raw.replacingOccurrences(of: "@", with: ""))")
    }
}

