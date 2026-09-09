import SwiftUI

// Event cards in the explore feed's "cinema" style — the same geometry, type
// and materials as HeroCard and LandCard next to them (220pt hero photo with
// the info panel below on Theme.surface; 220×130 landscape card with overlay
// text), so an event reads as one more card in the feed rather than a
// transplant from a different design.
//
// What differs is the CONTENT, not the styling. An event leads with its own
// name and who is playing, and names the venue underneath; a venue card leads
// with the venue. Everything here goes through Theme tokens, so both cards
// follow light and dark mode with the rest of the feed.

private struct EventPhoto: View {
    let url: String?
    let height: CGFloat
    /// Largest display dimension (points), so the photo is fetched right-sized
    /// instead of at its stored 800px. nil = fetched native.
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
                    // Not the venue glyph the club cards fall back to — an
                    // event without a flyer is still an event, not a room.
                    Image(systemName: "sparkles")
                        .font(.system(size: 28))
                        .foregroundStyle(Theme.fadedSand.opacity(0.4))
                }
            }
            .frame(height: height)
            .clipped()
    }
}

/// The corner marker, in the feed's filled-pill idiom (see TagPill on the venue
/// cards). Only ever ONE of these, and the order below is the priority:
/// tonight is time-critical, a pin is our editorial choice, "ours" is
/// provenance. Stacking all three would turn the card into a badge shelf.
///
/// The promoter's paid `featured` flag is deliberately NOT surfaced as a badge
/// — the buyer gets rank in the feed, not a label telling guests they paid.
private struct EventTag: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        if event.isTonight {
            pill(locale.t("events.tonightTag"), background: Theme.ember, color: .white)
        } else if event.pinned {
            // Dark ink on gold, not white: white on #C09950 is about 2:1 and
            // unreadable at 9pt.
            pill(locale.t("events.pickTag"), background: Theme.gold, color: Color(hex: 0x221E1A))
        } else if event.house {
            pill(locale.t("events.oursTag"), background: .black.opacity(0.5), color: .white.opacity(0.85))
        }
    }

    private func pill(_ text: String, background: Color, color: Color) -> some View {
        Text(text.uppercased())
            .font(.cfSans(9, weight: .medium))
            .kerning(1)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(background, in: .capsule)
    }
}

// ── Hero (the pinned event, above the venue shelves) ──────────────────────────

struct EventHeroCard: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                EventPhoto(url: event.image, height: 220)
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
                    EventTag(event: event)
                    Spacer()
                }
                .padding(12)

                if event.isFree {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            Text(locale.t("events.free").uppercased())
                                .font(.cfSans(10, weight: .semibold))
                                .kerning(0.8)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 4)
                                .background(.black.opacity(0.55), in: .capsule)
                        }
                    }
                    .padding(12)
                }
            }
            .frame(height: 220)

            VStack(alignment: .leading, spacing: 6) {
                Text(locale.t("events.kicker").uppercased())
                    .font(.cfSans(9))
                    .kerning(1.3)
                    .foregroundStyle(Theme.fadedSand)

                Text(event.displayTitle)
                    .font(.cfSerif(30, italic: true))
                    .foregroundStyle(Theme.accent)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)

                // The line-up takes the slot the venue card gives its address,
                // hairline and all. It is the billing, and people choose a
                // night by who is playing; the blurb only shows when there are
                // no credits to bill.
                if let secondary = event.lineupLine() ?? event.description?.nilIfBlank {
                    Text(secondary.prefix(90))
                        .font(.cfSerif(13, italic: true))
                        .foregroundStyle(Theme.stone)
                        .lineLimit(2)
                        .padding(.leading, 10)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(Theme.hairline).frame(width: 2)
                        }
                }

                HStack {
                    Text(event.metaLine(locale: locale))
                        .font(.cfSans(11))
                        .foregroundStyle(Theme.fadedSand)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    HStack(spacing: 6) {
                        Text(locale.t("explore.viewEvent"))
                            .font(.cfSans(13, weight: .semibold))
                            .fixedSize()
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
}

// ── Rail card (220×130, overlay text — LandCard's geometry) ───────────────────

struct EventCard: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            EventPhoto(url: event.image, height: 130, targetWidth: FeedImage.thumbWidth)
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
                Text(event.displayTitle)
                    .font(.cfSans(13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                // Day and place only. The full meta line carries door times
                // too, which truncates away at 220pt — the times are on the
                // event page, one tap down. `placeLine` is the whole route on a
                // night that moves, not just the venue it starts at.
                Text([event.dayLabel(locale: locale), event.placeLine]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.cfSans(10))
                    .foregroundStyle(.white.opacity(0.6))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)

            VStack {
                HStack(alignment: .top) {
                    EventTag(event: event)
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
}

private extension String {
    var nilIfBlank: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
