import SwiftUI

/// One event, opened from the Explore feed.
///
/// Reserving writes an ordinary BOOKING, so the spot inherits everything a
/// booking already has — the pass, the Tickets tab, arrival check-in, Wallet
/// and the post-night venue survey. The server also puts the guest on the
/// night's door list, which is what the room's capacity is actually counted
/// against; nothing on this screen has to know that.
struct EventDetailView: View {
    let event: FeedEvent
    @Environment(LocaleStore.self) private var locale
    @Environment(\.api) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var reserving = false
    @State private var reserved = false
    @State private var reserveError: String?
    @State private var showGuestGate = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero

                VStack(alignment: .leading, spacing: 0) {
                    Text(event.metaLine(locale: locale).uppercased())
                        .font(.cfMono(11))
                        .kerning(0.9)
                        .foregroundStyle(Explore.ink3)
                        .padding(.bottom, 10)

                    Text(event.displayTitle)
                        .font(.cfDisplay(30, weight: .bold))
                        .foregroundStyle(Explore.ink)
                        .padding(.bottom, 14)

                    factRow
                        .padding(.bottom, 20)

                    if !event.credits.isEmpty {
                        lineupSection
                            .padding(.bottom, 20)
                    }

                    if let description = event.description, !description.isEmpty {
                        Text(description)
                            .font(.cfSans(15))
                            .foregroundStyle(Explore.ink2)
                            .lineSpacing(5)
                            .padding(.bottom, 20)
                    }

                    if let address = event.address, !address.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(locale.t("events.where").uppercased())
                                .font(.cfMono(9.5))
                                .kerning(1.2)
                                .foregroundStyle(Explore.ink3)
                            Text(address)
                                .font(.cfSans(14))
                                .foregroundStyle(Explore.ink2)
                        }
                        .padding(.bottom, 20)
                    }
                }
                .padding(.horizontal, Explore.gutter)
                .padding(.top, 20)
            }
            .padding(.bottom, 40)
        }
        .background(Explore.bg)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) { reserveBar }
        .sheet(isPresented: $showGuestGate) {
            GuestGateView(reason: .save).presentationDetents([.medium])
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                Button {
                    Haptics.tap()
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Explore.ink)
                        .frame(width: 38, height: 38)
                        .background(Explore.surface, in: .circle)
                        .overlay(Circle().stroke(Explore.line))
                }
                .padding(.leading, 16)
                Spacer()
            }
            .padding(.vertical, 4)
        }
    }

    // ── Reserve ───────────────────────────────────────────────────────────────

    /// Pinned to the bottom so it is reachable without scrolling past the
    /// line-up. Hidden entirely for an event with no venue: `bookings.club_id`
    /// is NOT NULL, so a night at a free-text address has nothing to book
    /// against, and offering a button that always errors is worse than none.
    @ViewBuilder private var reserveBar: some View {
        if event.clubId != nil {
            VStack(spacing: 8) {
                if let reserveError {
                    Text(reserveError)
                        .font(.cfSans(12))
                        .foregroundStyle(Explore.ember)
                        .multilineTextAlignment(.center)
                }

                Button {
                    guard auth.hasAccount else { showGuestGate = true; return }
                    Task { await reserve() }
                } label: {
                    HStack(spacing: 8) {
                        if reserving {
                            ProgressView().tint(Explore.onAccent)
                        } else if reserved {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        Text(reserved ? locale.t("events.reserved") : locale.t("events.reserve"))
                            .font(.cfSans(15, weight: .semibold))
                    }
                    .foregroundStyle(reserved ? Explore.ink : Explore.onAccent)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(reserved ? Explore.surface2 : Explore.accent, in: .capsule)
                    .overlay {
                        if reserved {
                            Capsule().stroke(Explore.lineStrong, lineWidth: 1)
                        }
                    }
                }
                .disabled(reserving || reserved)

                Text(reserved ? locale.t("events.reservedHint") : locale.t("events.reserveHint"))
                    .font(.cfSans(11.5))
                    .foregroundStyle(Explore.ink3)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, Explore.gutter)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .background(.ultraThinMaterial)
            .overlay(alignment: .top) {
                Rectangle().fill(Explore.line).frame(height: 1)
            }
        }
    }

    private struct ReserveResult: Decodable, Sendable {
        let bookingId: String?
        let already: Bool?
    }

    private func reserve() async {
        reserving = true
        reserveError = nil
        do {
            let _: ReserveResult = try await api.post("/api/events/\(event.id)/reserve")
            reserved = true
            Haptics.success()
        } catch {
            reserveError = error.localizedDescription
        }
        reserving = false
    }

    /// Who is playing, in billed order. Names only — an artist's photo lives on
    /// the `djs` row and is not carried on the event, so a credit renders as an
    /// initial disc rather than fetching 1..n images the card never promised.
    private var lineupSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(locale.t("events.lineup").uppercased())
                .font(.cfMono(9.5))
                .kerning(1.2)
                .foregroundStyle(Explore.ink3)

            VStack(spacing: 8) {
                ForEach(event.credits, id: \.key) { credit in
                    HStack(spacing: 12) {
                        Text(String(credit.name.prefix(1)).uppercased())
                            .font(.cfDisplay(15, weight: .bold))
                            .foregroundStyle(Explore.onAccent)
                            .frame(width: 34, height: 34)
                            .background(Explore.accent, in: .circle)
                        Text(credit.name)
                            .font(.cfSans(15, weight: .medium))
                            .foregroundStyle(Explore.ink)
                        Spacer()
                    }
                }
            }
        }
    }

    private var hero: some View {
        Explore.photoPlaceholder
            .overlay {
                if let url = event.image.flatMap(URL.init(string:)) {
                    CachedAsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                        placeholder: { Explore.photoPlaceholder }
                }
            }
            .overlay { GrainOverlay() }
            .frame(height: 260)
            .clipped()
    }

    /// Only facts we actually hold. Capacity is shown as the size of the room,
    /// never as spots remaining — remaining would need the live guest count,
    /// and a stale number here is worse than no number.
    private var factRow: some View {
        HStack(spacing: 10) {
            if event.isFree {
                fact(locale.t("events.entry"), locale.t("events.free"))
            }
            if let capacity = event.totalCapacity, capacity > 0 {
                fact(locale.t("events.capacity"), "\(capacity)")
            }
            // Whoever is actually credited. Falls back to Club Fuoco only for
            // a house event with no hosts recorded — otherwise the tile is
            // dropped rather than asserting a host we do not know.
            if let hosts = event.hostLine {
                fact(locale.t("events.host"), hosts)
            } else if event.house {
                fact(locale.t("events.host"), "Club Fuoco")
            }
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.cfMono(9))
                .kerning(1.1)
                .foregroundStyle(Explore.ink3)
            Text(value)
                .font(.cfSans(14, weight: .semibold))
                .foregroundStyle(Explore.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Explore.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Explore.line, lineWidth: 1))
    }
}
