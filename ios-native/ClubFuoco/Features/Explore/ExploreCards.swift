import SwiftUI

// Native ports of the explore "cinema" cards (HeroCard / LandCard /
// PosterCard) and the shelf row. Cards push the venue detail route.

private struct CardPhoto: View {
    let url: String?
    let height: CGFloat
    /// Largest display dimension (points) of this card, so the photo is
    /// fetched right-sized instead of at its stored 800px. nil = full-bleed
    /// (hero), fetched native.
    var targetWidth: CGFloat? = nil

    var body: some View {
        Theme.imagePlaceholder
            .overlay {
                if let url, let parsed = URL(string: url) {
                    CachedAsyncImage(url: parsed, targetWidth: targetWidth) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Theme.imagePlaceholder
                    }
                } else {
                    Image(systemName: "music.note.house")
                        .font(.system(size: 30))
                        .foregroundStyle(Theme.fadedSand.opacity(0.4))
                }
            }
            .frame(height: height)
            .clipped()
    }
}

/// Save toggle on card photos — bookmark glyph, matching the saved-clubs
/// button in the explore header for continuity (was a red heart).
private struct SaveBookmark: View {
    let isSaved: Bool
    let size: CGFloat
    var target: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                .font(.system(size: size * 0.5))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(.black.opacity(0.45), in: .circle)
                // Grow the tap target to ~44pt (Apple's minimum) by giving the
                // button a larger frame with the glyph centered in it. The whole
                // frame is the hit area, so the visible circle and the tappable
                // region stay aligned and the footprint is honest.
                //
                // The old version faked this with .padding(pad).contentShape()
                // .padding(-pad): the negative padding detached the hit region
                // from the glyph and let it spill past the card's edge into the
                // neighbouring card, which sits on top and stole the tap — you
                // had to tap left of the glyph to actually save.
                .frame(width: target, height: target)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

private struct TagPill: View {
    let text: String
    var background: Color = .black.opacity(0.5)
    var color: Color = .white.opacity(0.85)

    var body: some View {
        Text(text.uppercased())
            .font(.cfSans(9, weight: .medium))
            .kerning(1)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(background, in: .capsule)
    }
}

// ── Hero (featured shelf lead) ────────────────────────────────────────────────

struct HeroCard: View {
    let place: Place
    let isSaved: Bool
    let onSave: () -> Void
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan
    @Environment(\.pushPlace) private var pushPlace

    var body: some View {
        Group {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .topLeading) {
                    CardPhoto(url: place.coverPhoto, height: 220)
                        .overlay(
                            LinearGradient(
                                stops: [
                                    .init(color: .black.opacity(0.45), location: 0),
                                    .init(color: .clear, location: 0.5),
                                    .init(color: .black.opacity(0.3), location: 1),
                                ],
                                startPoint: .top, endPoint: .bottom
                            )
                        )

                    HStack(alignment: .top) {
                        TagPill(text: (place.musicGenres.first ?? "Featured").replacingOccurrences(of: "_", with: " "))
                        Spacer()
                    }
                    .padding(12)

                    if let rating = RumbaScore.score(clubId: place.placeId, realRating: place.rating).value {
                        VStack {
                            Spacer()
                            HStack {
                                Spacer()
                                HStack(spacing: 3) {
                                    Image(systemName: "star.fill")
                                        .font(.system(size: 10))
                                        .foregroundStyle(Theme.starGold)
                                    Text(String(format: "%.1f", rating))
                                        .font(.cfSans(12, weight: .semibold))
                                        .foregroundStyle(.white)
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(.black.opacity(0.55), in: .capsule)
                            }
                        }
                        .padding(12)
                    }
                }
                .frame(height: 220)

                VStack(alignment: .leading, spacing: 6) {
                    Text("\(locale.t("explore.featured")) \(plan.nightPhrase(locale: locale))".uppercased())
                        .font(.cfSans(9))
                        .kerning(1.3)
                        .foregroundStyle(Theme.fadedSand)

                    // Venue name alone — the kicker above already carries the
                    // night, and a "Tonight:" prefix forced long names into an
                    // awkward two-line wrap.
                    Text(place.name)
                        .font(.cfSerif(30, italic: true))
                        .foregroundStyle(Theme.accent)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)

                    if !place.address.isEmpty {
                        Text(place.address.prefix(90))
                            .font(.cfSerif(13, italic: true))
                            .foregroundStyle(Theme.stone)
                            .lineLimit(2)
                            .padding(.leading, 10)
                            .overlay(alignment: .leading) {
                                Rectangle().fill(Theme.hairline).frame(width: 2)
                            }
                    }

                    HStack {
                        Text(meta)
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.fadedSand)
                        Spacer()
                        HStack(spacing: 6) {
                            Text(locale.t("explore.viewClub"))
                                .font(.cfSans(13, weight: .semibold))
                            Image(systemName: "arrow.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundStyle(Theme.cream)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .background(Theme.ink, in: .capsule)
                    }
                    .padding(.top, 6)
                }
                .padding(.init(top: 16, leading: 20, bottom: 18, trailing: 20))
            }
            .background(Theme.surface)
            .clipShape(.rect(cornerRadius: 16))
            .shadow(color: Color(hex: 0x221E1A).opacity(0.06), radius: 12, y: 8)
        }
        // Navigate from a frame-scoped tap, not a wrapping NavigationLink — see
        // PushPlaceKey. The save overlay sits above and wins its own region.
        .contentShape(.rect)
        .onTapGesture { pushPlace(place) }
        .overlay(alignment: .topTrailing) {
            SaveBookmark(isSaved: isSaved, size: 32, action: onSave).padding(6)
        }
    }

    private var meta: String {
        [place.neighborhood, place.priceLevel.map { Place.priceLabels[$0] }]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

// ── Landscape card (220×130 image, overlay text) ──────────────────────────────

struct LandCard: View {
    let place: Place
    let isSaved: Bool
    let onSave: () -> Void
    @Environment(\.pushPlace) private var pushPlace

    var body: some View {
        Group {
            ZStack(alignment: .bottomLeading) {
                CardPhoto(url: place.coverPhoto, height: 130, targetWidth: FeedImage.thumbWidth)
                    .overlay(
                        LinearGradient(
                            stops: [
                                .init(color: .black.opacity(0.7), location: 0),
                                .init(color: .clear, location: 0.55),
                            ],
                            startPoint: .bottom, endPoint: .top
                        )
                    )

                VStack(alignment: .leading, spacing: 1) {
                    Text(place.name)
                        .font(.cfSans(13, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text([place.neighborhood, place.priceLevel.map { Place.priceLabels[$0] }]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.cfSans(10))
                        .foregroundStyle(.white.opacity(0.6))
                        .lineLimit(1)
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 8)

                VStack {
                    HStack(alignment: .top) {
                        if let genre = place.musicGenres.first {
                            TagPill(text: genre.replacingOccurrences(of: "_", with: " "), background: .black.opacity(0.45), color: .white.opacity(0.8))
                        }
                        Spacer()
                    }
                    Spacer()
                }
                .padding(7)
            }
            .frame(width: 220, height: 130)
            .clipShape(.rect(cornerRadius: 12))
            .shadow(color: Color(hex: 0x221E1A).opacity(0.06), radius: 8, y: 4)
        }
        // Frame-scoped tap instead of a wrapping NavigationLink — see PushPlaceKey.
        .contentShape(.rect)
        .onTapGesture { pushPlace(place) }
        .overlay(alignment: .topTrailing) {
            SaveBookmark(isSaved: isSaved, size: 28, action: onSave).padding(2)
        }
    }
}

// ── Poster card (150 wide, info below) ────────────────────────────────────────

struct PosterCard: View {
    let place: Place
    let isSaved: Bool
    let onSave: () -> Void
    @Environment(LocaleStore.self) private var locale
    @Environment(\.pushPlace) private var pushPlace

    var body: some View {
        Group {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .topLeading) {
                    CardPhoto(url: place.coverPhoto, height: 168, targetWidth: FeedImage.thumbWidth)
                        .overlay(
                            LinearGradient(
                                stops: [
                                    .init(color: .black.opacity(0.55), location: 0),
                                    .init(color: .clear, location: 0.5),
                                ],
                                startPoint: .bottom, endPoint: .top
                            )
                        )

                    HStack(alignment: .top) {
                        if place.isOpen == true {
                            TagPill(text: locale.t("explore.open"), background: Theme.success, color: .white)
                        } else if let distance = place.distance {
                            TagPill(text: ExploreViewModel.formatDistance(distance), background: .black.opacity(0.4), color: .white.opacity(0.75))
                        }
                        Spacer()
                    }
                    .padding(6)
                }
                .frame(height: 168)

                VStack(alignment: .leading, spacing: 2) {
                    // Two lines with reserved height: "Opium Barcelona R…"
                    // truncating mid-word read badly, and the fixed frame
                    // keeps every card in the row the same height.
                    Text(place.name)
                        .font(.cfSans(13, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                        .frame(height: 34, alignment: .topLeading)
                    Text(place.neighborhood ?? place.address)
                        .font(.cfSans(10))
                        .foregroundStyle(Theme.fadedSand)
                        .lineLimit(1)
                }
                .padding(.init(top: 8, leading: 10, bottom: 10, trailing: 10))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(width: 150)
            .background(Theme.surface)
            .clipShape(.rect(cornerRadius: 12))
            .shadow(color: Color(hex: 0x221E1A).opacity(0.06), radius: 7, y: 4)
        }
        // Frame-scoped tap instead of a wrapping NavigationLink — see PushPlaceKey.
        // This is what stops a tap near the card edge (e.g. the bookmark) from
        // being claimed by the neighbouring card's link.
        .contentShape(.rect)
        .onTapGesture { pushPlace(place) }
        .overlay(alignment: .topTrailing) {
            SaveBookmark(isSaved: isSaved, size: 26, action: onSave).padding(3)
        }
    }
}

// ── Shelf row ─────────────────────────────────────────────────────────────────

struct ShelfRowView: View {
    let shelf: Shelf
    let index: Int
    let saved: Set<String>
    let onSave: (Place) -> Void
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan

    // The featured deal shelf is grouped inside a soft gold-framed box so it
    // reads as one distinct section; everything else flows edge-to-edge.
    // Gold (#C09950) is the brand accent — the frame must never drift warm
    // enough to read pink.
    private var isRumba: Bool { shelf.id == "hero" }
    private var hPad: CGFloat { isRumba ? 16 : 20 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(shelf.subtitle.uppercased())
                    .font(.cfSans(9))
                    .kerning(1.3)
                    .foregroundStyle(Theme.fadedSand)
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    if isRumba {
                        // Featured header — tracks the When planner date
                        // (e.g. "Tonight", "Next Thursday").
                        Text(plan.nightPhrase(locale: locale))
                            .font(.cfSans(18, weight: .medium))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .layoutPriority(1)
                    } else {
                        Text(shelf.title)
                            .font(.cfSans(shelf.featured ? 18 : 16, weight: .medium))
                            .foregroundStyle(Theme.ink)
                    }
                    Spacer(minLength: 6)
                    NavigationLink(value: shelf) {
                        Text(String(format: locale.t("explore.venuesArrow"), shelf.places.count))
                            .font(.cfSans(12))
                            .foregroundStyle(Theme.accent)
                            .lineLimit(1)
                            .fixedSize()
                            // Generous tap target without shifting the layout.
                            .padding(.vertical, 8)
                            .padding(.leading, 12)
                            .contentShape(.rect)
                            .padding(.vertical, -8)
                            .padding(.leading, -12)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, hPad)

            if shelf.featured, let lead = shelf.places.first {
                HeroCard(place: lead, isSaved: saved.contains(lead.placeId)) { onSave(lead) }
                    .padding(.horizontal, hPad)

                if shelf.places.count > 1 {
                    cardScroller(Array(shelf.places.dropFirst()), landscape: false)
                }
            } else {
                cardScroller(shelf.places, landscape: index % 2 != 0)
            }
        }
        // Asymmetric padding inside the featured box — the bottom row of
        // venue thumbnails has its address subtitle right at the card's lower
        // edge, plus a soft shadow that extends another ~10pt below the card
        // bounds. 18pt of bottom buffer pressed it all against the outline;
        // 44pt gives an unambiguous breathing zone.
        .padding(.top, isRumba ? 20 : 0)
        .padding(.bottom, isRumba ? 44 : 0)
        .background {
            if isRumba {
                RoundedRectangle(cornerRadius: 22)
                    .fill(Theme.gold.opacity(0.06))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22)
                            .strokeBorder(Theme.gold.opacity(0.35), lineWidth: 1)
                    )
            }
        }
        .padding(.horizontal, isRumba ? 12 : 0)
        // Extra gap below the featured container so the next shelf header
        // ("FOR THE 4/4 FAITHFUL" etc.) doesn't visually press into the box.
        .padding(.bottom, isRumba ? 40 : 32)
    }

    private func cardScroller(_ places: [Place], landscape: Bool) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(places) { place in
                    if landscape {
                        LandCard(place: place, isSaved: saved.contains(place.placeId)) { onSave(place) }
                    } else {
                        PosterCard(place: place, isSaved: saved.contains(place.placeId)) { onSave(place) }
                    }
                }
            }
            .padding(.horizontal, hPad)
        }
    }
}
