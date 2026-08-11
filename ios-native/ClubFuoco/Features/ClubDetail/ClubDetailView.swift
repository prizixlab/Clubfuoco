import SwiftUI

/// Venue detail — native port of the web "cinema" club page (clubs/place/[id]):
/// an edge-to-edge hero with the venue name overlaid in white serif, a white
/// sheet that slides up over it, a four-stat fact strip, "The Pitch" quote,
/// genre/tag chips, a photos strip, and the opening-hours accordion. The
/// booking flow runs via Apple Pay (BookNightSheet).
struct ClubDetailView: View {
    let place: Place
    @Environment(AuthStore.self) private var auth
    @Environment(LocaleStore.self) private var locale
    @Environment(PlanStore.self) private var plan
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.api) private var api
    @State private var detail: PlaceDetail?
    @State private var events: [ClubEvent] = []
    @State private var featuredDJs: [FeaturedDJ] = []
    @State private var activeDJ: FeaturedDJ?
    @State private var djAutoplay = false
    @State private var hoursOpen = false
    @State private var showBookSheet = false
    @State private var showGuestGate = false
    @State private var activeOffer: RumbalistOffer?
    @State private var planGroup: GroupRef?
    @State private var photoViewer: PhotoIndex?

    /// Offers actually running on the night the user has planned: the night
    /// must fall within the offer's validDays AND not be one of the supplier's
    /// skipped dates. `liveOn` covers both — `runsOn` checks only skipped
    /// dates, which showed a "Sun – Fri" offer on a Saturday here while the
    /// feed correctly hid it. The server now refuses that booking too.
    private var offers: [RumbalistOffer] {
        RumbalistOffers.offers(for: place.placeId).filter { $0.liveOn(plan.date) }
    }

    /// Offers live on a specific date (the `offers` property covers plan.date).
    private func offers(on date: String) -> [RumbalistOffer] {
        RumbalistOffers.offers(for: place.placeId).filter { $0.liveOn(date) }
    }

    /// Next date (today…14d ahead, YYYY-MM-DD) matching an English weekday name
    /// like "Wednesdays" — the weekday club_dj_sets stores. nil if unrecognised
    /// or out of the booking window.
    private func nextDate(forNight night: String?) -> String? {
        guard let night else { return nil }
        let idx: [String: Int] = ["sundays": 1, "mondays": 2, "tuesdays": 3,
                                  "wednesdays": 4, "thursdays": 5, "fridays": 6,
                                  "saturdays": 7]
        guard let wd = idx[night.lowercased()] else { return nil }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = .current
        let today = cal.startOfDay(for: Date())
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
        for add in 0...PlanStore.maxDaysAhead {
            guard let d = cal.date(byAdding: .day, value: add, to: today) else { continue }
            if cal.component(.weekday, from: d) == wd { return f.string(from: d) }
        }
        return nil
    }

    private let heroHeight: CGFloat = 360

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                sheet
                    .offset(y: -32)   // slide the white sheet up over the hero
            }
        }
        .background(Color.white)
        .ignoresSafeArea(edges: .top)
        .scrollIndicators(.hidden)
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .topLeading) { backButton }
        .sheet(isPresented: $showBookSheet) {
            if let detail { BookNightSheet(detail: detail) }
        }
        .sheet(isPresented: $showGuestGate) {
            GuestGateView().presentationDetents([.medium])
        }
        .sheet(item: $activeOffer) { offer in
            RumbalistOfferSheet(
                offer: offer,
                clubId: place.placeId,
                venueName: place.name,
                venueAddress: detail?.address ?? place.address,
                onPlanWithFriends: { groupId in
                    // The offer sheet dismisses itself; present the new group
                    // (to invite friends) once it's gone.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                        planGroup = GroupRef(id: groupId)
                    }
                }
            )
        }
        .sheet(item: $planGroup) { ref in
            NavigationStack { GroupDetailView(groupId: ref.id, presentedModally: true) }
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $photoViewer) { idx in
            PhotoViewer(photos: photos, startIndex: idx.value)
        }
        .sheet(item: $activeDJ) { dj in
            // The guestlist for a DJ box is for the DJ's OWN night, not tonight:
            // target the next occurrence of their weekday and open the offer live
            // on that date (booking then uses plan.date = that night).
            let djDate = nextDate(forNight: dj.night)
            let djOffers = offers(on: djDate ?? plan.date)
            FeaturedDJSheet(
                dj: dj,
                autoplay: djAutoplay,
                bookable: !djOffers.isEmpty,
                onBook: djOffers.isEmpty ? nil : {
                    if let djDate { plan.date = djDate }
                    // Let the DJ sheet finish dismissing before opening the offer.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                        activeOffer = djOffers.first
                    }
                }
            )
        }
        .task {
            // Events are independent of the detail row, so a failure on either
            // side leaves the other rendering.
            async let upcoming = (try? auth.queries.clubEvents(clubId: place.placeId)) ?? []
            async let djs = (try? auth.queries.featuredDJs(clubId: place.placeId)) ?? []
            detail = try? await auth.queries.clubById(place.placeId)
            events = await upcoming
            featuredDJs = await djs
            #if DEBUG
            if ProcessInfo.processInfo.environment["CF_TEST_BOOK"] == "1", detail != nil {
                showBookSheet = true
            }
            if ProcessInfo.processInfo.environment["CF_TEST_OPEN_OFFER"] == "1" {
                activeOffer = offers.first
            }
            #endif
        }
    }

    // ── Resolved fields (detail falls back to the feed Place) ─────────────────

    private var photos: [String] { detail?.photos.isEmpty == false ? detail!.photos : place.photos }
    private var genres: [String] { detail?.musicGenres ?? place.musicGenres }
    private var tags: [String] { detail?.tags ?? place.tags }
    private var weekdayHours: [String] { detail?.weekdayHours ?? place.weekdayHours }
    private var ratingsTotal: Int { detail?.ratingsTotal ?? place.ratingsTotal }
    private var ratingResult: RumbaScore.Result {
        RumbaScore.score(clubId: place.placeId, realRating: detail?.rating ?? place.rating)
    }
    private var rating: Double? { ratingResult.value }
    private var entryPrice: Double? { detail?.generalEntryPrice ?? place.generalEntryPrice }
    private var openStatus: Bool? {
        detail?.isOpen ?? place.isOpen ?? Hours.computeOpenNow(weekdayHours)
    }

    // ── Hero ──────────────────────────────────────────────────────────────────

    private var hero: some View {
        // The hero photo is not tappable — the photos strip below is the way to
        // open the full-screen viewer.
        ZStack(alignment: .bottomLeading) {
            Color(hex: 0xEFE9DD)
                .overlay {
                    if let url = photos.first.flatMap(URL.init(string:)) {
                        CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0xEFE9DD) }
                    } else {
                        Image(systemName: "music.note.house")
                            .font(.system(size: 44))
                            .foregroundStyle(Theme.fadedSand.opacity(0.4))
                    }
                }
                .frame(height: heroHeight)
                .clipped()

            // Multi-stop scrim: darken top (status bar) + bottom (overlaid text)
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.48), location: 0),
                    .init(color: .clear, location: 0.35),
                    .init(color: .clear, location: 0.45),
                    .init(color: .black.opacity(0.65), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: heroHeight)
            .allowsHitTesting(false)

            VStack(alignment: .leading, spacing: 6) {
                if let genre = genres.first {
                    Text(genre.replacingOccurrences(of: "_", with: " ").uppercased())
                        .font(.cfMono(9))
                        .kerning(1.8)
                        .foregroundStyle(.white.opacity(0.65))
                }
                Text(place.name)
                    .font(.cfSerif(38, italic: true))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text(detail?.address ?? place.address)
                    .font(.cfSans(12))
                    .foregroundStyle(.white.opacity(0.6))
                    .lineLimit(1)
            }
            .padding(.init(top: 0, leading: 20, bottom: 44, trailing: 20))
        }
        .frame(height: heroHeight)
    }

    private var backButton: some View {
        Button {
            Haptics.tap()
            dismiss()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
                .frame(width: 38, height: 38)
                .background(.black.opacity(0.4), in: .circle)
                .overlay(Circle().stroke(.white.opacity(0.12)))
        }
        .padding(.leading, 16)
        .padding(.top, 8)
    }

    // ── White sheet ───────────────────────────────────────────────────────────

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Drag handle
            Capsule()
                .fill(Theme.hairline)
                .frame(width: 36, height: 4)
                .frame(maxWidth: .infinity)
                .padding(.top, 14)

            factStrip
                .padding(.init(top: 20, leading: 20, bottom: 0, trailing: 20))

            if let description = detail?.description, !description.isEmpty {
                pitch(description)
                    .padding(.init(top: 24, leading: 20, bottom: 0, trailing: 20))
            }

            if !genres.isEmpty || !tags.isEmpty {
                chips
                    .padding(.init(top: 20, leading: 20, bottom: 0, trailing: 20))
            }

            // Photos sit between the pitch/chips and the booking sections:
            // the venue sells itself visually, then we ask for the booking.
            if photos.count > 1 {
                photosStrip
                    .padding(.top, 24)
            }

            if !offers.isEmpty {
                rumbalistSection
                    .padding(.init(top: 24, leading: 20, bottom: 0, trailing: 20))
            }

            if !events.isEmpty || !featuredDJs.isEmpty {
                eventsSection
                    .padding(.init(top: 24, leading: 20, bottom: 0, trailing: 20))
            }

            if !weekdayHours.isEmpty {
                hoursAccordion
                    .padding(.init(top: 24, leading: 20, bottom: 0, trailing: 20))
            }

            actionRow
                .padding(.init(top: 24, leading: 20, bottom: 0, trailing: 20))
        }
        .padding(.bottom, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white, in: .rect(topLeadingRadius: 24, topTrailingRadius: 24))
    }

    // ── Fact strip ────────────────────────────────────────────────────────────

    private var factStrip: some View {
        HStack(spacing: 4) {
            factTile(label: locale.t("detail.door"), value: doorLabel)
            factTile(label: locale.t("detail.reviewsLabel"), value: reviewsLabel, sub: ratingsTotal > 0 ? locale.t("detail.onGoogle") : nil)
            factTile(label: locale.t("detail.statusLabel"), value: statusValue, valueColor: statusColor)
            factTile(label: locale.t("detail.ratingLabel"), value: rating.map { String(format: "%.1f", $0) } ?? "—", sub: ratingResult.boosted ? "Rumba Score" : nil, star: rating != nil)
        }
    }

    private var doorLabel: String {
        guard let price = entryPrice else { return "?" }
        return price == 0 ? locale.t("detail.free") : "€\(Int(price))"
    }
    private var reviewsLabel: String {
        ratingsTotal > 999 ? String(format: "%.1fk", Double(ratingsTotal) / 1000) : (ratingsTotal > 0 ? "\(ratingsTotal)" : "—")
    }
    private var statusValue: String {
        switch openStatus {
        case true: return locale.t("detail.open")
        case false: return locale.t("detail.closed")
        default: return "—"
        }
    }
    private var statusColor: Color {
        switch openStatus {
        case true: return Color(hex: 0x2D7A46)
        case false: return Theme.wine
        default: return Theme.fadedSand
        }
    }

    private func factTile(label: String, value: String, sub: String? = nil, valueColor: Color = Theme.ink, star: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text(label.uppercased())
                .font(.cfMono(9))
                .kerning(1.2)
                .foregroundStyle(Theme.fadedSand)
            HStack(spacing: 3) {
                if star {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Color(hex: 0xD4A017))
                }
                Text(value)
                    .font(.cfSans(15, weight: .bold))
                    .foregroundStyle(valueColor)
            }
            // Always reserve the sub row (blank space when none) so labels,
            // values and disclaimers line up across every tile.
            Text(sub ?? " ")
                .font(.cfSans(9))
                .foregroundStyle(Theme.fadedSand)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.vertical, 12)
        .padding(.horizontal, 4)
        .background(Theme.cream, in: .rect(cornerRadius: 12))
    }

    // ── The Pitch ─────────────────────────────────────────────────────────────

    private func pitch(_ description: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(locale.t("detail.pitch").uppercased())
                .font(.cfMono(9))
                .kerning(1.6)
                .foregroundStyle(Theme.fadedSand)
            // No attribution line — "— <club name>" read as if the club wrote
            // its own pitch.
            Text("“\(description)”")
                .font(.cfSerif(18, italic: true))
                .foregroundStyle(Theme.stone)
                .lineSpacing(3)
                .padding(.leading, 14)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Color(hex: 0x221E1A).opacity(0.16)).frame(width: 2)
                }
        }
    }

    // ── Chips ─────────────────────────────────────────────────────────────────

    private var chips: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(genres, id: \.self) { g in
                Text(g.replacingOccurrences(of: "_", with: " "))
                    .font(.cfSans(11))
                    .foregroundStyle(Theme.wine)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(Theme.wine.opacity(0.08), in: .capsule)
            }
            ForEach(tags.prefix(4), id: \.self) { t in
                Text(t.replacingOccurrences(of: "_", with: " "))
                    .font(.cfSans(11))
                    .foregroundStyle(Theme.fadedSand)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(Theme.cream, in: .capsule)
            }
        }
    }

    // ── Upcoming events ───────────────────────────────────────────────────────
    // One box per event at this venue. We do NOT sell these: Resident Advisor
    // has no purchase API, so the row opens RA's own page in Safari. The click
    // is logged first for partner attribution.
    //
    // No price is shown — the source's `cost` is free text and unreliable.

    private var eventsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(locale.t("detail.upcomingEvents").uppercased())
                    .font(.cfMono(9))
                    .kerning(1.8)
                    .foregroundStyle(Theme.fadedSand)
                Text(locale.t("detail.whatsOn"))
                    .font(.cfSerif(22, italic: true))
                    .foregroundStyle(Theme.ink)
            }

            VStack(spacing: 10) {
                // DJ-set slots first — these are the "not really an event, it's a
                // DJ" case and read as the highlight.
                ForEach(featuredDJs) { dj in
                    FeaturedDJBox(dj: dj) { autoplay in
                        djAutoplay = autoplay
                        activeDJ = dj
                    }
                }
                ForEach(events) { event in
                    eventBox(event)
                }
            }
        }
    }

    private func eventBox(_ event: ClubEvent) -> some View {
        let parts = event.dateParts
        return VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                // Date block — the thing people scan for
                VStack(spacing: 1) {
                    Text(parts.weekday)
                        .font(.cfMono(9))
                        .kerning(1.2)
                        .foregroundStyle(Theme.gold)
                    Text(parts.day)
                        .font(.cfSans(22, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Text(parts.month)
                        .font(.cfMono(9))
                        .kerning(1)
                        .foregroundStyle(Theme.fadedSand)
                }
                .frame(width: 46)

                VStack(alignment: .leading, spacing: 6) {
                    Text(event.title)
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 12) {
                        if let start = event.startLabel {
                            Label(start, systemImage: "clock")
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.fadedSand)
                        }
                        if let interested = event.interested, interested > 0 {
                            Label(String(format: locale.t("detail.interestedCount"), interested),
                                  systemImage: "person.2")
                                .font(.cfSans(12))
                                .foregroundStyle(Theme.fadedSand)
                        }
                    }

                    if !event.lineup.isEmpty {
                        Text(event.lineup.joined(separator: " · ")
                             + (event.extraArtists > 0 ? " +\(event.extraArtists)" : ""))
                            .font(.cfSans(12))
                            .foregroundStyle(Theme.stone)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let promoters = event.promoters, !promoters.isEmpty {
                        Text(String(format: locale.t("detail.presentedBy"),
                                    promoters.joined(separator: " · ")))
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.fadedSand)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)

            if let url = event.ticketsURL {
                Divider().overlay(Theme.hairline)
                Button {
                    Haptics.tap()
                    logTicketClick(event)
                    openURL(url)
                } label: {
                    HStack(spacing: 6) {
                        Text(locale.t("detail.ticketsOnRA"))
                            .font(.cfSans(13, weight: .semibold))
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(Theme.wine)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
    }

    /// Attribution telemetry — fire and forget, never blocks opening the link.
    private func logTicketClick(_ event: ClubEvent) {
        // Encodable keys are converted to snake_case by APIClient's encoder.
        struct Click: Encodable, Sendable {
            let eventId: String
            let platform: String
            let eventTitle: String
            let venueName: String
            let venuePlaceId: String
            let eventDate: String
        }
        struct Ack: Decodable, Sendable { let logged: Bool? }

        let click = Click(
            eventId: event.raEventId, platform: "ra", eventTitle: event.title,
            venueName: event.venueName ?? place.name, venuePlaceId: place.placeId,
            eventDate: event.date)
        Task { let _: Ack? = try? await api.post("/api/ticket-clicks", body: click) }
    }

    /// Transport telemetry — fire and forget, never blocks opening the deep link.
    /// Records which club the guest tried to travel to and via which option.
    private func logTransportClick(_ platform: String) {
        // Encodable keys are converted to snake_case by APIClient's encoder.
        struct Click: Encodable, Sendable {
            let platform: String
            let clubPlaceId: String
            let clubName: String
        }
        struct Ack: Decodable, Sendable { let logged: Bool? }

        let click = Click(platform: platform, clubPlaceId: place.placeId, clubName: place.name)
        Task { let _: Ack? = try? await api.post("/api/transport-clicks", body: click) }
    }

    // ── Rumbalist offers ──────────────────────────────────────────────────────

    private var rumbalistSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(locale.t("rumbalist.bookVenue").uppercased())
                    .font(.cfMono(9))
                    .kerning(1.8)
                    .foregroundStyle(Theme.fadedSand)
                // Tracks the When planner — "Tonight's options" only when the
                // planned night IS tonight, otherwise the selected day.
                Text(plan.date <= PlanStore.today()
                     ? locale.t("rumbalist.tonightOptions")
                     : String(format: locale.t("rumbalist.optionsFor"), plan.nightPhrase(locale: locale)))
                    .font(.cfSerif(22, italic: true))
                    .foregroundStyle(Theme.ink)
            }

            VStack(spacing: 10) {
                ForEach(offers) { offer in
                    Button {
                        Haptics.tap()
                        if auth.user == nil || auth.isAnonymous {
                            showGuestGate = true
                        } else {
                            activeOffer = offer
                        }
                    } label: {
                        offerCard(offer)
                    }
                    .buttonStyle(.plain)
                }
            }

            Text(locale.t("rumbalist.confirmationNote"))
                .font(.cfSans(10))
                .foregroundStyle(Theme.fadedSand)
                .padding(.leading, 4)
        }
    }

    private func offerCard(_ offer: RumbalistOffer) -> some View {
        let ink = Color(hex: 0x2A1B08)   // dark text on the gold VIP card
        return HStack(spacing: 14) {
            // Icon tile
            Image(systemName: offer.isVip ? "wineglass.fill" : "list.bullet.rectangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(offer.isVip ? ink : Theme.ink)
                .frame(width: 44, height: 44)
                .background(
                    offer.isVip ? ink.opacity(0.18) : Color(hex: 0x221E1A).opacity(0.06),
                    in: .rect(cornerRadius: 12)
                )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    // No fixedSize — that forced the row wider than the screen
                    // (horizontal-scroll bug). Shrinks a hair before yielding
                    // the mark's space; the mark keeps priority so it never
                    // gets squeezed / wrapped.
                    Text(localizedOfferTitle(offer))
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(offer.isVip ? ink : Theme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    // Credit the supplier behind THIS offer ("Free Guestlist
                    // with [Rumbalist mark]"). Per-offer, so a venue can list
                    // offers from different suppliers and each is credited
                    // correctly — and a supplier swap never leaves a stale mark.
                    if let brand = offer.brand {
                        Text("with")
                            .font(.cfSans(11))
                            .foregroundStyle((offer.isVip ? ink : Theme.ink).opacity(0.75))
                            .lineLimit(1)
                            .fixedSize()
                        // Painted in the supplier's own accent colour (their
                        // brand.color, e.g. Rumbalist pink) so the mark reads as
                        // theirs — falls back to ember if the colour is unset.
                        SupplierMark(brand: brand, height: 11, animated: false,
                                     tint: Color(hexString: brand.color) ?? Theme.ember)
                            .layoutPriority(1)
                    }
                }
                Text(offer.subtitle)
                    .font(.cfSans(12))
                    .foregroundStyle((offer.isVip ? ink : Theme.stone).opacity(offer.isVip ? 0.7 : 1))
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
            }

            Spacer(minLength: 6)

            Text(locale.t(offer.isVip ? "rumbalist.book" : "rumbalist.join"))
                .font(.cfSans(11, weight: .semibold))
                .foregroundStyle((offer.isVip ? ink : Theme.ink).opacity(0.9))
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.init(top: 14, leading: 16, bottom: 14, trailing: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if offer.isVip {
                LinearGradient(
                    colors: [Color(hex: 0xF7E9C8), Color(hex: 0xEBD092), Color(hex: 0xD8B06A)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            } else {
                Theme.cream
            }
        }
        .clipShape(.rect(cornerRadius: 16))
    }

    private func localizedOfferTitle(_ offer: RumbalistOffer) -> String {
        locale.t(offer.isVip ? "rumbalist.titleVip" : "rumbalist.titleFree")
    }

    // ── Photos strip ──────────────────────────────────────────────────────────

    private var photosStrip: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(locale.t("detail.photos").uppercased())
                .font(.cfMono(9))
                .kerning(1.6)
                .foregroundStyle(Theme.fadedSand)
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(photos.dropFirst().enumerated()), id: \.offset) { i, url in
                        Button {
                            Haptics.tap()
                            photoViewer = PhotoIndex(value: i + 1)
                        } label: {
                            Color(hex: 0xEFE9DD)
                                .overlay {
                                    if let parsed = URL(string: url) {
                                        // Thumbnail strip — right-sized; the full
                                        // photo loads native in the tap-through viewer.
                                        CachedAsyncImage(url: parsed, targetWidth: 140) { $0.resizable().aspectRatio(contentMode: .fill) } placeholder: { Color(hex: 0xEFE9DD) }
                                    }
                                }
                                .frame(width: 140, height: 100)
                                .clipShape(.rect(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    // ── Hours accordion ───────────────────────────────────────────────────────

    private var hoursAccordion: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.spring(duration: 0.25)) { hoursOpen.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "clock")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.wine)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(locale.t("detail.openingHours").uppercased())
                            .font(.cfMono(9))
                            .kerning(1.2)
                            .foregroundStyle(Theme.fadedSand)
                        Text(hoursStatusLabel)
                            .font(.cfSans(13, weight: .medium))
                            .foregroundStyle(hoursStatusColor)
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.fadedSand)
                        .rotationEffect(.degrees(hoursOpen ? 180 : 0))
                }
            }
            .padding(.vertical, 12)

            if hoursOpen {
                VStack(spacing: 0) {
                    ForEach(Array(weekdayHours.enumerated()), id: \.offset) { i, row in
                        let parts = splitHours(row)
                        let isToday = i == (Calendar.current.component(.weekday, from: Date()) + 5) % 7
                        HStack {
                            Text(parts.day)
                                .font(.cfSans(13, weight: isToday ? .semibold : .regular))
                                .foregroundStyle(isToday ? Theme.wine : Theme.stone)
                            Spacer()
                            Text(parts.hours)
                                .font(.cfSans(13))
                                .foregroundStyle(isToday ? Theme.ink : Theme.stone)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(isToday ? Theme.wine.opacity(0.09) : .clear)
                        if i < weekdayHours.count - 1 {
                            Divider().overlay(Theme.hairline)
                        }
                    }
                }
                .background(Theme.cream, in: .rect(cornerRadius: 12))
            }
        }
    }

    private var hoursStatusLabel: String {
        switch openStatus {
        case true: return locale.t("detail.openNow")
        case false: return locale.t("detail.closedNow")
        default: return locale.t("detail.seeHours")
        }
    }
    private var hoursStatusColor: Color {
        switch openStatus {
        case true: return Color(hex: 0x1F8F4A)
        case false: return Theme.stone
        default: return Theme.ink
        }
    }

    private func splitHours(_ row: String) -> (day: String, hours: String) {
        guard let colon = row.firstIndex(of: ":") else { return (row, "") }
        let day = String(row[row.startIndex..<colon]).trimmingCharacters(in: .whitespaces)
        let hours = String(row[row.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        return (day, hours)
    }

    // ── Directions / Uber / Instagram ─────────────────────────────────────────

    private var actionRow: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                if let maps = directionsURL {
                    Button {
                        logTransportClick("maps")
                        openURL(maps)
                    } label: {
                        actionPill(locale.t("detail.openMaps"), icon: "map", dark: false)
                    }
                }
                if let uber = uberURL {
                    Button {
                        logTransportClick("uber")
                        openURL(uber)
                    } label: {
                        actionPill("Uber", icon: "car.fill", dark: true)
                    }
                }
            }
            if let instagram = detail?.instagramURL {
                Link(destination: instagram) {
                    actionPill("Instagram", icon: "camera", dark: false)
                }
            }
        }
    }

    private func actionPill(_ title: String, icon: String, dark: Bool) -> some View {
        Label(title, systemImage: icon)
            .font(.cfSans(13, weight: .medium))
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .background(dark ? Color(hex: 0x0A0A0A) : Theme.cream, in: .rect(cornerRadius: 12))
            .foregroundStyle(dark ? Color.white : Theme.ink)
    }

    /// Apple Maps directions deep link (opens the Maps app directly) — mirrors
    /// the web's iOS `directionsUrl`. Falls back to a coordinate search.
    private var directionsURL: URL? {
        let lat = place.lat, lng = place.lng
        let name = place.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "maps://maps.apple.com/?daddr=\(lat),\(lng)&q=\(name)")
    }

    /// Uber pickup deep link to the venue (port of the web "Ride with Uber").
    private var uberURL: URL? {
        let lat = place.lat, lng = place.lng
        let name = place.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let addr = (detail?.address ?? place.address).addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "https://m.uber.com/ul/?action=setPickup&pickup=my_location"
            + "&dropoff%5Blatitude%5D=\(lat)&dropoff%5Blongitude%5D=\(lng)"
            + "&dropoff%5Bnickname%5D=\(name)&dropoff%5Bformatted_address%5D=\(addr)")
    }

}

/// Minimal flow layout — wraps chips onto multiple lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0; y += lineHeight + lineSpacing; lineHeight = 0
            }
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX; y += lineHeight + lineSpacing; lineHeight = 0
            }
            sub.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}

/// Identifiable index for the fullscreen photo viewer cover.
private struct PhotoIndex: Identifiable {
    let value: Int
    var id: Int { value }
}
