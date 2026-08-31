import SwiftUI

// Event cards for the Events tab. Same geometry and type scale as the explore
// feed's venue cards — 300pt hero, 164pt rail card — so the two feeds read as
// one surface. What differs is the content: an event leads with its own name
// and night, and names the venue underneath, where a venue card leads with the
// venue.

/// Photo with the design's scrim and grain. A local copy rather than a shared
/// one: the explore version is scoped to venue cards and takes a `Place`-shaped
/// set of options this does not need.
private struct EventPhoto: View {
    let url: String?
    var targetWidth: CGFloat? = nil
    var tall: Bool = false

    private var stops: [Gradient.Stop] {
        tall
            ? [
                .init(color: .black.opacity(0.88), location: 0),
                .init(color: .black.opacity(0.35), location: 0.45),
                .init(color: .black.opacity(0.05), location: 0.75),
                .init(color: .clear, location: 1),
              ]
            : [
                .init(color: .black.opacity(0.55), location: 0),
                .init(color: .clear, location: 0.55),
              ]
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
                    Image(systemName: "sparkles")
                        .font(.system(size: 26))
                        .foregroundStyle(Explore.ink3.opacity(0.5))
                }
            }
            .overlay { GrainOverlay() }
            .overlay(LinearGradient(stops: stops, startPoint: .bottom, endPoint: .top))
            .clipped()
    }
}

/// The corner marker. Only ever ONE of these, and the order below is the
/// priority: tonight is time-critical, a pin is our editorial choice, "ours"
/// is provenance. Stacking all three would turn the card into a badge shelf.
///
/// The promoter's paid `featured` flag is deliberately NOT surfaced as a badge
/// — the buyer gets rank in the feed, not a label telling guests they paid.
private struct EventTag: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale
    @State private var dim = false

    var body: some View {
        if event.isTonight {
            tag(locale.t("events.tonightTag"), color: Explore.ember, pulsing: true)
        } else if event.pinned {
            tag(locale.t("events.pickTag"), color: Explore.accent, filled: true)
        } else if event.house {
            tag(locale.t("events.oursTag"), color: Explore.accent, filled: true)
        }
    }

    private func tag(_ text: String, color: Color, filled: Bool = false, pulsing: Bool = false) -> some View {
        HStack(spacing: 5) {
            if pulsing {
                Circle()
                    .fill(color)
                    .frame(width: 5, height: 5)
                    .opacity(dim ? 0.35 : 1)
                    .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
                    .onAppear { dim = true }
            }
            Text(text.uppercased())
                .font(.cfMono(9))
                .kerning(1.1)
        }
        .foregroundStyle(filled ? Explore.onAccent : color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background {
            Capsule()
                .fill(filled ? color.opacity(0.92) : Color.black.opacity(0.5))
                .overlay {
                    if !filled { Capsule().stroke(color.opacity(0.5), lineWidth: 1) }
                }
        }
    }
}

// ── Hero ──────────────────────────────────────────────────────────────────────

/// The biggest slot on the tab — the editorially pinned event.
struct EventHeroCard: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            EventPhoto(url: event.image, tall: true)

            VStack(alignment: .leading, spacing: 0) {
                Text(event.metaLine(locale: locale).uppercased())
                    .font(.cfMono(11))
                    .kerning(0.9)
                    .foregroundStyle(Explore.onPhotoDim)
                    .lineLimit(1)
                    .padding(.bottom, 8)

                Text(event.displayTitle)
                    .font(.cfDisplay(26, weight: .bold))
                    .foregroundStyle(Explore.onPhoto)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .padding(.bottom, 8)

                // The line-up is the billing and outranks the blurb: people
                // choose a night by who is playing. The description only shows
                // when there are no credits.
                if let lineup = event.lineupLine() {
                    Text(lineup)
                        .font(.cfSans(13.5, weight: .medium))
                        .foregroundStyle(Explore.onPhoto)
                        .lineLimit(1)
                } else if let description = event.description, !description.isEmpty {
                    Text(description)
                        .font(.cfSans(13.5))
                        .foregroundStyle(Explore.onPhotoDim)
                        .lineLimit(2)
                }
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
        .overlay(alignment: .topLeading) {
            EventTag(event: event).padding(16)
        }
    }
}

// ── Rail card ─────────────────────────────────────────────────────────────────

struct EventCard: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            EventPhoto(url: event.image, targetWidth: FeedImage.thumbWidth)
                .frame(width: 164, height: 110)
                .overlay(alignment: .topLeading) {
                    EventTag(event: event).padding(8)
                }

            VStack(alignment: .leading, spacing: 6) {
                Text(event.dayLabel(locale: locale).uppercased()
                     + (event.timeLabel.map { " · \($0)" } ?? ""))
                    .font(.cfMono(10.5))
                    .kerning(0.6)
                    .foregroundStyle(Explore.ink2)
                    .lineLimit(1)

                // Fixed height so every card in a rail is the same height,
                // whatever the title length.
                Text(event.displayTitle)
                    .font(.cfDisplay(14))
                    .foregroundStyle(Explore.ink)
                    .lineLimit(2)
                    .frame(height: 34, alignment: .topLeading)

                Text(event.venueName ?? event.address ?? "")
                    .font(.cfSans(11.5))
                    .foregroundStyle(Explore.ink2)
                    .lineLimit(1)

                if let lineup = event.lineupLine(max: 2) {
                    Text(lineup)
                        .font(.cfSans(11.5, weight: .medium))
                        .foregroundStyle(Explore.ink)
                        .lineLimit(1)
                }

                if event.isFree {
                    Text(locale.t("events.free").uppercased())
                        .font(.cfMono(9.5))
                        .kerning(0.8)
                        .foregroundStyle(Explore.accent)
                        .padding(.top, 2)
                }
            }
            .padding(.init(top: 10, leading: 11, bottom: 12, trailing: 11))
        }
        .frame(width: 164)
        .background(Explore.surface)
        .clipShape(.rect(cornerRadius: Explore.rFeed))
        .overlay(
            RoundedRectangle(cornerRadius: Explore.rFeed)
                .stroke(event.pinned ? Explore.accent : Explore.lineStrong, lineWidth: 1)
        )
    }
}
