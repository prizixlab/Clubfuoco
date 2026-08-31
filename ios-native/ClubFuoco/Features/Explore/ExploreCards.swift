import SwiftUI

// Native port of the dark explore design ("Event Cards - App Front.html"):
// FeaturedCard (.evt-featured), FeedCard (.evt-feed) and EventRow (.evt-row),
// plus the shelf section head and rails.
//
// The design draws EVENTS; this app's feed ranks VENUES (`Place`), and that
// stays the unit — `ShelfBuilder` is untouched. So each card keeps the
// design's geometry, type scale and variants, and fills its slots with the
// venue facts we actually hold:
//
//     design slot      venue fact
//     ───────────      ──────────
//     title            place.name
//     venue / meta     neighborhood, distance, price level
//     lineup line      music genres (rails) / address (featured)
//     tag pills        music genres
//     price            Fuoco score — see `scoreLabel`
//     CTA              (none — see below)
//
// The design's CTA buttons are deliberately NOT built. The whole card is the
// tap target and opens the venue, which is where an offer is actually joined,
// so a button inside the card only competed with it. That also settles the
// `link` variant ("Tickets on RA ↗"), which we would not have built anyway:
// `ClubEvent.raUrl` is provenance we never surface. No price is printed
// either, because the only door-price column we hold is unreliable free text.
//
// What survives of the design's variants is the FRAME: `offer` keeps the
// accent border and soft accent wash for a venue with a live Rumbalist offer
// on the planned night, and the plain card is everything else.

// ── Photo ─────────────────────────────────────────────────────────────────────

/// A card photo with the design's two fixed overlays: the bottom-to-clear
/// scrim (`.thumb::after`) and the film grain (`.thumb-grain`).
private struct CardPhoto: View {
    let url: String?
    /// Largest display dimension (points) of this card, so the photo is
    /// fetched right-sized instead of at its stored 800px. nil = full-bleed
    /// (featured), fetched native.
    var targetWidth: CGFloat? = nil
    /// Which scrim to lay over the photo. `thumb` is the design's short
    /// `.thumb::after` ramp; `featured` is its taller three-stop
    /// `.evt-featured::after`, which has to carry four lines of type over an
    /// arbitrary, often bright, venue photo.
    enum Scrim { case thumb, featured }
    var scrim: Scrim = .thumb

    /// Transcribed from the CSS rather than approximated. The featured ramp is
    /// three stops — .88 at the foot, .35 at 45%, .05 at 75% — and a two-stop
    /// linear fade is markedly weaker through the middle, which is exactly
    /// where the title sits.
    private var scrimStops: [Gradient.Stop] {
        switch scrim {
        case .thumb:
            return [
                .init(color: .black.opacity(0.55), location: 0),
                .init(color: .clear, location: 0.55),
            ]
        case .featured:
            return [
                .init(color: .black.opacity(0.88), location: 0),
                .init(color: .black.opacity(0.35), location: 0.45),
                .init(color: .black.opacity(0.05), location: 0.75),
                .init(color: .clear, location: 1),
            ]
        }
    }

    var body: some View {
        Explore.photoPlaceholder
            .overlay {
                if let url, let parsed = URL(string: url) {
                    CachedAsyncImage(url: parsed, targetWidth: targetWidth) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Explore.photoPlaceholder
                    }
                } else {
                    Image(systemName: "music.note.house")
                        .font(.system(size: 26))
                        .foregroundStyle(Explore.ink3.opacity(0.5))
                }
            }
            .overlay { GrainOverlay() }
            .overlay(
                LinearGradient(stops: scrimStops, startPoint: .bottom, endPoint: .top)
            )
            .clipped()
    }
}

// ── Small parts ───────────────────────────────────────────────────────────────

/// `.thumb-tag` — the corner marker on a photo. Two kinds: a solid accent
/// "Guestlist" and an outlined ember "Open" with a pulsing dot.
private struct ThumbTag: View {
    enum Kind { case offer, live }
    let kind: Kind
    let text: String
    @State private var dim = false

    var body: some View {
        HStack(spacing: 5) {
            if kind == .live {
                Circle()
                    .fill(Explore.ember)
                    .frame(width: 5, height: 5)
                    // `.dot--pulse` — 1.8s ease-in-out, opacity 1 → .35.
                    .opacity(dim ? 0.35 : 1)
                    .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
                    .onAppear { dim = true }
            }
            Text(text.uppercased())
                .font(.cfMono(9))
                .kerning(1.1)
        }
        .foregroundStyle(kind == .offer ? Explore.onAccent : Explore.ember)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background {
            Capsule()
                .fill(kind == .offer ? Explore.accent.opacity(0.92) : Color.black.opacity(0.5))
                .overlay {
                    if kind == .live {
                        Capsule().stroke(Explore.ember.opacity(0.5), lineWidth: 1)
                    }
                }
        }
    }
}

/// `.evt-tag` — a genre pill under a row's title.
private struct GenrePill: View {
    let text: String

    var body: some View {
        Text(text.replacingOccurrences(of: "_", with: " ").uppercased())
            .font(.cfMono(9.5))
            .kerning(0.8)
            .foregroundStyle(Explore.ink2)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Explore.surface2, in: .capsule)
            .overlay(Capsule().stroke(Explore.line, lineWidth: 1))
    }
}

/// Save toggle on card photos. The 44pt frame is load-bearing, not decorative:
/// an earlier version faked the tap target with `.padding(pad).contentShape()
/// .padding(-pad)`, and the negative padding let the hit region spill past the
/// card edge into the neighbouring card, which sits on top and stole the tap.
/// The whole frame is the hit area, so the visible circle and the tappable
/// region stay aligned.
private struct SaveBookmark: View {
    let isSaved: Bool
    let size: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                .font(.system(size: size * 0.5))
                .foregroundStyle(isSaved ? Explore.accent : .white)
                .frame(width: size, height: size)
                .background(.black.opacity(0.45), in: .circle)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

// ── Shared venue-fact formatting ──────────────────────────────────────────────

/// The facts each card slot shows, derived once so the three card types agree.
struct VenueFacts {
    let place: Place
    let hasOffer: Bool

    /// Genres, de-underscored, capped — the design's lineup line and tag pills.
    var genres: [String] {
        Array(place.musicGenres.prefix(3))
            .map { $0.replacingOccurrences(of: "_", with: " ") }
    }

    var genreLine: String? {
        genres.isEmpty ? nil : genres.joined(separator: ", ")
    }

    /// `.evt-meta` — mono, uppercase. Distance and price level where we have
    /// them, neighborhood otherwise.
    var meta: String {
        [place.neighborhood,
         place.distance.map(ExploreViewModel.formatDistance),
         place.priceLevel.map { Place.priceLabels[$0] }]
            .compactMap { $0 }
            .prefix(2)
            .joined(separator: " · ")
    }

    /// Fills the design's `evt-price` slot. Not a price — we hold no reliable
    /// door price, so the slot carries the Fuoco score instead, which is the
    /// number this feed actually ranks on.
    var scoreLabel: String? {
        FuocoScore.score(clubId: place.placeId, realRating: place.rating).value
            .map { String(format: "%.1f", $0) }
    }

    /// The photo corner tag: a live offer outranks an open door.
    @ViewBuilder var thumbTag: some View {
        if hasOffer {
            ThumbTag(kind: .offer, text: "Guestlist")
        } else if place.isOpen == true {
            ThumbTag(kind: .live, text: "Open")
        }
    }
}

/// `evt-price` slot — the score, rendered as the design renders its price.
///
/// It appears in two places with opposite grounds: on the featured card it sits
/// over a scrimmed photo, on the rail and row cards it sits on the card body.
/// `onPhoto` picks the fixed light pair rather than the adaptive one, because
/// the photo is dark in both appearances.
private struct ScoreLabel: View {
    let value: String?
    var size: CGFloat = 12.5
    var onPhoto = false

    var body: some View {
        if let value {
            HStack(spacing: 3) {
                Image(systemName: "flame.fill")
                    .font(.system(size: size - 3.5))
                    .foregroundStyle(onPhoto ? Explore.onPhoto : Explore.accent)
                Text(value)
                    .font(.cfMono(size, weight: .medium))
                    .foregroundStyle(onPhoto ? Explore.onPhoto : Explore.ink)
            }
        }
    }
}

// ── Featured (.evt-featured) ──────────────────────────────────────────────────

/// 300pt full-bleed hero with a gold border. Leads the featured shelf.
struct FeaturedCard: View {
    let place: Place
    let hasOffer: Bool
    let isSaved: Bool
    let onSave: () -> Void
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan
    @Environment(\.pushPlace) private var pushPlace

    private var facts: VenueFacts { VenueFacts(place: place, hasOffer: hasOffer) }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            CardPhoto(url: place.coverPhoto, scrim: .featured)

            VStack(alignment: .leading, spacing: 0) {
                // `.evt-featured-meta`
                Text("\(locale.t("explore.featured")) \(plan.nightPhrase(locale: locale)) · \(facts.meta)"
                    .uppercased())
                    .font(.cfMono(11))
                    .kerning(0.9)
                    .foregroundStyle(Explore.onPhotoDim)
                    .lineLimit(1)
                    .padding(.bottom, 8)

                // `.evt-featured-title`
                Text(place.name)
                    .font(.cfDisplay(26, weight: .bold))
                    .foregroundStyle(Explore.onPhoto)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .padding(.bottom, 8)

                // `.evt-featured-lineup` — genres where we have them, address
                // otherwise, so the line is never empty.
                Text(facts.genreLine ?? String(place.address.prefix(60)))
                    .font(.cfSans(13.5))
                    .foregroundStyle(Explore.onPhotoDim)
                    .lineLimit(1)
                    .padding(.bottom, 12)

                // `.evt-featured-bottom` — score only. The whole card is the
                // tap target, so the design's CTA button is not needed to
                // reach the venue.
                ScoreLabel(value: facts.scoreLabel, size: 14, onPhoto: true)
            }
            .padding(18)
        }
        .frame(height: 300)
        .clipShape(.rect(cornerRadius: Explore.rFeatured))
        .overlay(
            RoundedRectangle(cornerRadius: Explore.rFeatured)
                .stroke(Explore.accent, lineWidth: 1.5)
        )
        .shadow(color: .black.opacity(0.45), radius: 20, y: 16)
        // Navigate from a frame-scoped tap, not a wrapping NavigationLink — see
        // PushPlaceKey. The save overlay sits above and wins its own region.
        .contentShape(.rect)
        .onTapGesture { pushPlace(place) }
        .overlay(alignment: .topLeading) {
            facts.thumbTag.padding(16)
        }
        .overlay(alignment: .topTrailing) {
            SaveBookmark(isSaved: isSaved, size: 32, action: onSave).padding(6)
        }
    }
}

// ── Rail card (.evt-feed) ─────────────────────────────────────────────────────

/// 164pt-wide card for a horizontal rail: 110pt photo, facts beneath.
struct FeedCard: View {
    let place: Place
    let hasOffer: Bool
    let isSaved: Bool
    let onSave: () -> Void
    @Environment(\.pushPlace) private var pushPlace

    private var facts: VenueFacts { VenueFacts(place: place, hasOffer: hasOffer) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardPhoto(url: place.coverPhoto, targetWidth: FeedImage.thumbWidth)
                .frame(width: 164, height: 110)
                .overlay(alignment: .topLeading) {
                    facts.thumbTag.padding(8)
                }
                .overlay(alignment: .topTrailing) {
                    SaveBookmark(isSaved: isSaved, size: 26, action: onSave)
                        .padding(-3)
                }

            // `.evt-feed-body`
            VStack(alignment: .leading, spacing: 6) {
                Text(facts.meta.uppercased())
                    .font(.cfMono(10.5))
                    .kerning(0.6)
                    .foregroundStyle(Explore.ink2)
                    .lineLimit(1)

                // Two lines with reserved height: a fixed frame keeps every
                // card in the row the same height, and mid-word truncation on
                // long venue names ("Opium Barcelona R…") read badly.
                Text(place.name)
                    .font(.cfDisplay(14))
                    .foregroundStyle(Explore.ink)
                    .lineLimit(2)
                    .frame(height: 34, alignment: .topLeading)

                Text(facts.genreLine ?? place.address)
                    .font(.cfSans(11.5))
                    .foregroundStyle(Explore.ink2)
                    .lineLimit(1)

                ScoreLabel(value: facts.scoreLabel, size: 11.5)
                    .padding(.top, 2)
            }
            .padding(.init(top: 10, leading: 11, bottom: 12, trailing: 11))
        }
        .frame(width: 164)
        .background(Explore.surface)
        .clipShape(.rect(cornerRadius: Explore.rFeed))
        .overlay(
            RoundedRectangle(cornerRadius: Explore.rFeed)
                .stroke(hasOffer ? Explore.accent : Explore.lineStrong, lineWidth: 1)
        )
        // Frame-scoped tap instead of a wrapping NavigationLink — this is what
        // stops a tap near the card edge from being claimed by the neighbour.
        .contentShape(.rect)
        .onTapGesture { pushPlace(place) }
    }
}

// ── List row (.evt-row) ───────────────────────────────────────────────────────

/// Full-width row: 88pt square thumb on the left, facts on the right. The
/// `offer` variant takes the gold border and a soft gold wash.
struct EventRow: View {
    let place: Place
    let hasOffer: Bool
    let isSaved: Bool
    let onSave: () -> Void
    @Environment(\.pushPlace) private var pushPlace

    private var facts: VenueFacts { VenueFacts(place: place, hasOffer: hasOffer) }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            CardPhoto(url: place.coverPhoto, targetWidth: FeedImage.thumbWidth)
                .frame(width: 88, height: 88)
                .clipShape(.rect(cornerRadius: Explore.rThumb))
                .overlay(alignment: .topLeading) {
                    facts.thumbTag
                        .scaleEffect(0.85, anchor: .topLeading)
                        .padding(6)
                }

            // `.evt-row-body`
            VStack(alignment: .leading, spacing: 5) {
                Text(place.name)
                    .font(.cfDisplay(15.5))
                    .foregroundStyle(Explore.ink)
                    .lineLimit(2)

                Text(facts.meta.uppercased())
                    .font(.cfMono(10.5))
                    .kerning(0.6)
                    .foregroundStyle(Explore.ink2)
                    .lineLimit(1)

                if !place.address.isEmpty {
                    Text(place.address)
                        .font(.cfSans(12))
                        .foregroundStyle(Explore.ink2)
                        .lineLimit(1)
                }

                if !facts.genres.isEmpty {
                    HStack(spacing: 5) {
                        ForEach(facts.genres, id: \.self) { GenrePill(text: $0) }
                    }
                }

                // `.evt-row-bottom`
                ScoreLabel(value: facts.scoreLabel)
                    .padding(.top, 6)
            }
        }
        .padding(12)
        .background {
            let shape = RoundedRectangle(cornerRadius: Explore.rCard)
            if hasOffer {
                shape
                    .fill(LinearGradient(
                        stops: [
                            .init(color: Explore.accentSoft, location: 0),
                            .init(color: Explore.surface, location: 0.4),
                        ],
                        startPoint: .top, endPoint: .bottom
                    ))
                    .shadow(color: .black.opacity(0.35), radius: 13, y: 10)
            } else {
                shape.fill(Explore.surface)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: Explore.rCard)
                .stroke(hasOffer ? Explore.accent : Explore.lineStrong,
                        lineWidth: hasOffer ? 1.5 : 1)
        )
        .contentShape(.rect)
        .onTapGesture { pushPlace(place) }
        .overlay(alignment: .topTrailing) {
            SaveBookmark(isSaved: isSaved, size: 26, action: onSave).padding(-2)
        }
    }
}

// ── Section head (.section-head) ──────────────────────────────────────────────

/// Mono overline + display title on the left, gold "See all" on the right.
struct SectionHead<Trailing: View>: View {
    let subtitle: String
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(subtitle.uppercased())
                    .font(.cfMono(9.5))
                    .kerning(1.2)
                    .foregroundStyle(Explore.ink3)
                    .lineLimit(1)
                Text(title)
                    .font(.cfDisplay(20, weight: .bold))
                    .foregroundStyle(Explore.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, Explore.gutter)
        .padding(.bottom, 12)
    }
}

// ── Shelf row ─────────────────────────────────────────────────────────────────

/// One shelf: a category header over a horizontal rail of venue cards — the
/// Netflix row. The featured shelf is the only one that differs, leading with
/// the full-width hero and trailing its remaining venues as a rail.
///
/// EVERY other shelf is a rail. The design's second section ("Near you") is a
/// vertical list, and an earlier pass alternated rail/list by index to match
/// it; that broke the row rhythm — a full-width list mid-feed reads as the end
/// of the browsing surface, and you cannot scan across categories any more.
/// `EventRow` is still used, but for the saved view, where a list is right.
struct ShelfRowView: View {
    let shelf: Shelf
    let saved: Set<String>
    /// Club ids with a live offer on the planned night — the only thing that
    /// earns a card the gold `offer` variant.
    let offerClubIds: Set<String>
    let onSave: (Place) -> Void
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(
                subtitle: shelf.subtitle,
                // The featured header tracks the When planner date
                // ("Tonight", "Next Thursday") — that is what the wheel above
                // is steering, so it has to be visible in the feed.
                title: shelf.featured ? plan.nightPhrase(locale: locale) : shelf.title
            ) {
                NavigationLink(value: shelf) {
                    Text(locale.t("explore.seeAll"))
                        .font(.cfSans(12.5, weight: .semibold))
                        .foregroundStyle(Explore.accent)
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

            if shelf.featured, let lead = shelf.places.first {
                FeaturedCard(
                    place: lead,
                    hasOffer: offerClubIds.contains(lead.placeId),
                    isSaved: saved.contains(lead.placeId)
                ) { onSave(lead) }
                .padding(.horizontal, Explore.gutter)

                if shelf.places.count > 1 {
                    rail(Array(shelf.places.dropFirst()))
                        .padding(.top, 18)
                }
            } else {
                rail(shelf.places)
            }
        }
        .padding(.top, 22)   // .section
    }

    private func rail(_ places: [Place]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(places) { place in
                    FeedCard(
                        place: place,
                        hasOffer: offerClubIds.contains(place.placeId),
                        isSaved: saved.contains(place.placeId)
                    ) { onSave(place) }
                }
            }
            .padding(.horizontal, Explore.gutter)
            .padding(.bottom, 6)
        }
    }
}
