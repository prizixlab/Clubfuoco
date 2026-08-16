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


/// Ported from the "Club Fuoco DJ Page" design (Claude Design project
/// 019e0f69). The design is authored on the `notte` palette; the app is
/// adaptive, so its tokens are mapped onto Theme rather than hardcoded:
/// --bg→cream, --surface→surface, --surface-2→surfaceRaised, --ink→ink,
/// --ink-2→stone, --ink-3→fadedSand, --accent→ember, --line→hairline.
///
/// The design drops the old "ALSO PLAYS AT" chips: those were undated venue
/// names, and the dated timeline below now says the same thing better.
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

    // --line-strong: the design's heavier rule, used on card borders and the
    // "coming soon" pill. Theme.hairline is --line.
    private var lineStrong: Color { Theme.fadedSand.opacity(0.34) }

    var body: some View {
        VStack(spacing: 0) {
            handle
            topBar
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    identity
                    if soundcloudURL != nil {
                        DJPlayerControl()
                            .padding(.horizontal, 18)
                            .padding(.top, 16)
                    }
                    residencyCard
                    scheduleSection
                    if dj.isGuest { guestNote }
                    if bookable, let onBook { guestlistCTA(onBook) }
                    Color.clear.frame(height: 36)
                }
            }
            .scrollIndicators(.hidden)
        }
        .background(Theme.cream.ignoresSafeArea())
        .presentationDetents([.large])
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

    // ── Sheet chrome ──────────────────────────────────────────────────────────

    private var handle: some View {
        Capsule().fill(lineStrong)
            .frame(width: 36, height: 4)
            .padding(.top, 10).padding(.bottom, 2)
    }

    private var topBar: some View {
        HStack {
            Text(locale.t("dj.sheetLabel").uppercased())
                .font(.cfMono(9.5)).kerning(1.9)
                .foregroundStyle(Theme.fadedSand)
            Spacer()
            HStack(spacing: 8) {
                if let share = shareURL {
                    ShareLink(item: share) { circleIcon("square.and.arrow.up") }
                        .buttonStyle(.plain)
                }
                Button { dismiss() } label: { circleIcon("xmark") }
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6).padding(.bottom, 4)
    }

    private func circleIcon(_ system: String) -> some View {
        Image(systemName: system)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.stone)
            .frame(width: 34, height: 34)
            .background(Theme.ink.opacity(0.08), in: .circle)
    }

    /// Their Instagram is the only public page we hold that is theirs — never
    /// the Resident Advisor profile, which the product deliberately doesn't
    /// send users to.
    private var shareURL: URL? { normalizedURL(dj.instagram, host: "instagram.com") }

    // ── Identity ──────────────────────────────────────────────────────────────

    private var identity: some View {
        HStack(alignment: .top, spacing: 16) {
            avatar
            VStack(alignment: .leading, spacing: 0) {
                Text(dj.name)
                    .font(.cfSerif(29, italic: true))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if let origin = dj.origin, !origin.isEmpty {
                    Text(origin.uppercased())
                        .font(.cfMono(10.5)).kerning(1.05)
                        .foregroundStyle(Theme.stone)
                        .padding(.top, 8)
                }
                if !dj.genres.isEmpty {
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(dj.genres.prefix(3), id: \.self) { genre in
                            Text(genre.uppercased())
                                .font(.cfMono(9)).kerning(0.72)
                                .foregroundStyle(Theme.stone)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(Theme.surfaceRaised, in: .capsule)
                                .overlay(Capsule().stroke(lineStrong))
                        }
                    }
                    .padding(.top, 10)
                }
                if !socialLinks.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(socialLinks, id: \.0) { item in
                            Button { Haptics.tap(); openURL(item.1) } label: {
                                Image(systemName: item.0)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.ember)
                                    .frame(width: 30, height: 30)
                                    .background(Theme.ink.opacity(0.08), in: .circle)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 11)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.top, 8).padding(.bottom, 4)
    }

    /// SF Symbol + URL for each social we actually hold. SoundCloud is omitted:
    /// the player above already plays it, so a link out is redundant.
    private var socialLinks: [(String, URL)] {
        var out: [(String, URL)] = []
        if let ig = normalizedURL(dj.instagram, host: "instagram.com") {
            out.append(("camera", ig))
        }
        if let site = dj.website, let url = URL(string: site.hasPrefix("http") ? site : "https://\(site)") {
            out.append(("globe", url))
        }
        return out
    }

    private var avatar: some View {
        Group {
            if let raw = dj.imageUrl, let url = URL(string: raw) {
                CachedAsyncImage(url: url, targetWidth: 220) {
                    $0.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.surfaceRaised }
            } else {
                // Design's empty state: the initial in display serif, not a
                // person glyph — a name is the one thing every DJ has.
                Theme.surfaceRaised.overlay(
                    Text(dj.name.prefix(1).uppercased())
                        .font(.cfSerif(34, italic: true))
                        .foregroundStyle(Theme.fadedSand)
                )
            }
        }
        .frame(width: 78, height: 78)
        .clipShape(.rect(cornerRadius: 20))
    }

    // ── Residency ─────────────────────────────────────────────────────────────

    @ViewBuilder private var residencyCard: some View {
        if dj.residencyLine != nil || dj.night != nil {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(locale.t("dj.residencyHere").uppercased())
                        .font(.cfMono(9)).kerning(1.44)
                        .foregroundStyle(Theme.fadedSand)
                    HStack(spacing: 0) {
                        // The label ("Guest"/"Resident") takes the accent; the
                        // night stays ink — the design's <b> split.
                        if let label = dj.residencyLabel, !label.isEmpty {
                            Text(label).foregroundStyle(Theme.ember)
                            if dj.night != nil { Text(" · ").foregroundStyle(Theme.ink) }
                        }
                        if let night = dj.night { Text(night).foregroundStyle(Theme.ink) }
                    }
                    .font(.cfSans(15.5, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(Theme.surface, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(lineStrong))
            .padding(.horizontal, 18)
            .padding(.top, 16)
        }
    }

    // ── Timeline ──────────────────────────────────────────────────────────────

    @ViewBuilder private var scheduleSection: some View {
        if !gigs.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                sectionLabel(locale.t("dj.upcoming"))
                VStack(spacing: 0) {
                    ForEach(Array(gigs.enumerated()), id: \.element.id) { index, gig in
                        gigRow(gig, isFirst: index == 0)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
        } else if gigsLoaded && !dj.isGuest {
            VStack(alignment: .leading, spacing: 0) {
                sectionLabel(locale.t("dj.upcoming"))
                Text(locale.t("dj.noDates").uppercased())
                    .font(.cfMono(10)).kerning(1.4)
                    .foregroundStyle(Theme.fadedSand)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 22).padding(.bottom, 8)
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.cfMono(9.5)).kerning(1.9)
            .foregroundStyle(Theme.ember)
            .padding(.bottom, 12)
    }

    /// One dated appearance. A venue we carry opens the club page; a city we
    /// have not launched carries a "Coming soon" pill and reveals which city.
    private func gigRow(_ gig: DJGig, isFirst: Bool) -> some View {
        let opensClub = gig.isBookable && gig.clubId != currentClubId && onOpenVenue != nil
        // Only a city we haven't launched offers the "coming soon" affordance.
        // A Barcelona venue we don't carry is just a night we can't sell.
        let revealsCity = gig.isAwayCity
        let showingCity = comingSoonGigId == gig.id

        return VStack(alignment: .leading, spacing: 0) {
            if !isFirst { Rectangle().fill(Theme.hairline).frame(height: 1) }
            Button {
                if let cid = gig.clubId, opensClub {
                    Haptics.tap(); onOpenVenue?(cid)
                } else if revealsCity {
                    Haptics.tap()
                    withAnimation(.easeInOut(duration: 0.18)) {
                        comingSoonGigId = showingCity ? nil : gig.id
                    }
                }
            } label: {
                HStack(spacing: 13) {
                    VStack(spacing: 2) {
                        Text(gig.dayNumber)
                            .font(.cfSans(19, weight: .bold))
                            .foregroundStyle(gig.isAwayCity ? Theme.stone : Theme.ink)
                        Text(gig.monthLabel.uppercased())
                            .font(.cfMono(8.5)).kerning(0.85)
                            .foregroundStyle(Theme.fadedSand)
                    }
                    .frame(width: 52)

                    VStack(alignment: .leading, spacing: 5) {
                        Text(gig.title ?? gig.venueName ?? "—")
                            .font(.cfSans(14.5, weight: .semibold))
                            .foregroundStyle(gig.isAwayCity ? Theme.stone : Theme.ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(gig.venueCityLine.uppercased())
                            .font(.cfMono(9.5)).kerning(0.76)
                            .foregroundStyle(Theme.stone)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)

                    if opensClub {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.ember)
                    } else if revealsCity {
                        Text(locale.t("dj.comingSoonShort"))
                            .font(.cfMono(8.5)).kerning(0.85)
                            .foregroundStyle(Theme.fadedSand)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .overlay(Capsule().stroke(lineStrong))
                            .fixedSize()
                    }
                }
                .padding(.vertical, 12)
                // The design mutes a night you can't act on, rather than hiding
                // it — a DJ on tour is signal, not a gap. A home-city night is
                // never muted: it is ours even when we have no page for it.
                .opacity(gig.isAwayCity ? 0.5 : 1)
            }
            .buttonStyle(.plain)
            .disabled(!opensClub && !revealsCity)

            if showingCity {
                Text(String(format: locale.t("dj.cityComingSoon"), gig.placeLabel))
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.stone)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 12)
            }
        }
    }

    // ── Guest (thin) ──────────────────────────────────────────────────────────

    private var guestNote: some View {
        Text(locale.t("dj.guestOnlyNote"))
            .font(.cfSans(13.5))
            .foregroundStyle(Theme.stone)
            .lineSpacing(5)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.top, 16)
    }

    // ── Guestlist CTA ─────────────────────────────────────────────────────────
    // Not in the design comp, kept because it is the sheet's one commercial
    // action: this is how a DJ box turns into a booking.

    private func guestlistCTA(_ run: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); dismiss(); run() } label: {
            Text(locale.t("dj.joinGuestlist").uppercased()
                 + (dj.night.map { " · \($0.uppercased())" } ?? ""))
                .font(.cfMono(11, weight: .medium)).kerning(0.8)
                .foregroundStyle(Theme.ember)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.ember.opacity(0.6)))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 18)
        .padding(.top, 20)
    }

    /// RA stores instagram as a full URL or bare handle — normalise both.
    private func normalizedURL(_ raw: String?, host: String) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if raw.hasPrefix("http"), let u = URL(string: raw) { return u }
        return URL(string: "https://\(host)/\(raw.replacingOccurrences(of: "@", with: ""))")
    }
}
