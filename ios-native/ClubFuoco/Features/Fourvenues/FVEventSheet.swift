import SwiftUI

/// One HypeList night on Fourvenues, booked with our UI — the same visual
/// language as RumbalistOfferSheet (supplier rule + mark, serif title, a
/// details card on a veil, an inverted CTA slab, an inline pass step), so a
/// HypeList guestlist feels like every other guestlist in the app.
///
/// Ways in are ordered by what the guest PAYS, never by what Fourvenues calls
/// them: free (joined in the background), pay at the door (background, owed
/// at the venue — loud), ticket and table (paid on Fourvenues' page).
struct FVEventSheet: View {
    /// The night the sheet opened on.
    private let opened: FVEvent
    /// The way in the guest tapped (Guestlist button, night card) — selected
    /// when the sheet opens.
    var initial: FVProduct? = nil
    /// Every room at this club with a free list tonight. More than one →
    /// a room picker; the Guestlist card covers them all as one offer.
    var rooms: [FVEvent] = []
    /// Opened from one of the three buttons: only that tier's ways in.
    var tier: FVTier? = nil

    init(event: FVEvent, initial: FVProduct? = nil, rooms: [FVEvent] = [], tier: FVTier? = nil) {
        self.opened = event
        self.initial = initial
        self.rooms = rooms
        self.tier = tier
    }

    @State private var room: FVEvent?
    /// The room being booked.
    private var event: FVEvent { room ?? opened }

    @Environment(AuthStore.self) private var auth
    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss

    @State private var selected: FVProduct?
    @State private var rate: FVRate?
    /// Tables whose venue allows it: pay the whole table now, not the deposit.
    @State private var payInFull = false
    /// Fourvenues' own summary for what's selected — subtotal, fee, total.
    @State private var quote: FVQuote?
    @State private var quantity = 1
    @State private var runner: FVFormRunner?
    @State private var working = false
    @State private var errorText: String?
    @State private var checkout: CheckoutTarget?
    @State private var confirmed: FVTicket?
    /// The QR didn't arrive within waitForQR's window.
    @State private var waitedOut = false
    /// A table sold on Fuoco checkout, paid and booked (VipSellers).
    @State private var fuocoBooked: RumbalistBookingResult?
    /// Phone for paid checkouts when the profile has none — asked once, kept.
    @State private var phoneInput: String = UserDefaults.standard.string(forKey: FVTicketStore.phoneKey) ?? ""
    /// Where Fourvenues mails the ticket: the private ticket inbox when it's
    /// live, the account email until then.
    @State private var ticketEmail: String?

    struct CheckoutTarget: Identifiable {
        let id = UUID()
        let url: URL
        let product: FVProduct
        let heads: Int
        let unitPrice: Double
        let paymentExpected: Bool
        var paidNow: Double? = nil
    }

    // Same adaptive palette as RumbalistOfferSheet.
    private static let ink = Color.adaptive(light: 0xF8F5EE, dark: 0x141416)
    private static let text = Color.adaptive(light: 0x221E1A, dark: 0xF5F5F7)
    private static func veil(_ o: Double) -> Color {
        Color.adaptive(light: 0x221E1A, lightAlpha: o, dark: 0xFFFFFF, darkAlpha: o)
    }
    private static let ctaFill = Color.adaptive(light: 0x221E1A, dark: 0xF3EEE0)
    private static let ctaLabel = Color.adaptive(light: 0xF8F5EE, dark: 0x141416)
    /// The brand selling this night.
    /// nil = VIP with different brands selling different tables and none
    /// picked yet — no brand is credited (each table row shows its own).
    private var seller: PartnerBrand? {
        if let fuoco { return fuoco.brand }
        if tier == .vip || selected?.settle == .table {
            if let picked = selected, picked.settle == .table { return FVCatalog.shared.brand(for: event) }
            return FVCatalog.shared.vipSeller(for: [event])
        }
        return FVCatalog.shared.brand(for: event)
    }
    /// The promoter selling the selected table on Fuoco checkout, if any.
    private var fuoco: VipSellers.Seller? { selected?.settle == .table ? selected?.soldBy : nil }
    /// Deposit / full for a Fuoco-checkout table, under the promoter's limit.
    private var fuocoModes: [VipSellers.Pay] {
        guard let fuoco, let rate else { return [] }
        return VipSellers.modes(rate, limit: fuoco.payment)
    }
    private var fuocoPay: VipSellers.Pay {
        let m = fuocoModes
        if m.count == 1 { return m[0] }
        return payInFull ? .full : .deposit
    }
    private var accent: Color { seller.flatMap { Color(hexString: $0.color) } ?? Theme.ember }

    /// Name + email from the account, for filling Fourvenues' form.
    private var account: (name: String, email: String)? {
        let name = (auth.profile?.fullName ?? "").trimmingCharacters(in: .whitespaces)
        let email = ticketEmail ?? auth.profile?.email ?? auth.user?.email ?? ""
        return name.isEmpty || email.isEmpty ? nil : (name, email)
    }

    /// Phone in international form for Fourvenues' paid form: the profile's,
    /// else what the guest typed here (FVPhone — never a guessed prefix).
    private var phone: String? {
        if let p = auth.profile?.phone, let n = FVPhone.normalize(p) { return n }
        return FVPhone.normalize(phoneInput)
    }

    private var needsPhoneField: Bool {
        guard let p = selected, p.settle == .online || p.settle == .table, p.soldBy == nil else { return false }
        return FVPhone.normalize(auth.profile?.phone ?? "") == nil
    }

    /// Why this way in can't be booked right now, before Fourvenues is even
    /// asked — shown in place of an error after the tap.
    private func blocker(_ p: FVProduct) -> String? {
        if FVAge.tooYoung(birthday: auth.profile?.birthday, minAge: p.minAge ?? event.minAge, night: event.night) {
            return String(format: locale.t("fv.underAge"), p.minAge ?? event.minAge ?? 18)
        }
        // The QR reaches a guestlist only by email; a relay address never gets
        // it unless the private inbox is in use.
        if let email = account?.email, FVRelay.unreachable(email) { return locale.t("fv.relayNoInbox") }
        if FVUnconfirmedLock.isLocked(p.id) { return locale.t("fv.checkingWithFV") }
        return nil
    }

    /// What tapping the button will actually charge now: Fourvenues' own figure
    /// once the page reported it (fees, table supplements, deposit or in
    /// full), else our estimate. The button used to show the feed price while
    /// the summary above it showed the real, higher total.
    private func chargeNow(_ p: FVProduct) -> (amount: Double, exact: Bool) {
        // Fuoco checkout: our own price, no Fourvenues fees.
        if p.settle == .table, p.soldBy != nil, let rate { return (VipSellers.amount(rate, fuocoPay), true) }
        if p.settle == .table, let q = quote, let total = q.total {
            let canSplit = rate?.offersFullPayment == true || (q.deposit ?? total) < total
            let inFull = payInFull || !canSplit || q.deposit == nil
            let now = inFull ? (q.full ?? total) : (q.deposit ?? total)
            let fee = (inFull ? q.fullFee : q.depositFee) ?? 0
            return (now + fee, true)
        }
        if p.settle == .online, let total = quote?.total { return (total, true) }
        if p.settle == .table { return (rate?.price ?? p.price, false) }
        return (p.price * Double(quantity), false)
    }

    /// Every way in, cheapest-to-commit first: free, door, ticket, table.
    /// Table zones tonight that have a floor plan.
    private var mappedZones: [FVProduct] {
        event.products.filter { $0.settle == .table && !($0.map?.spaces.isEmpty ?? true) }
    }

    private var waysIn: [FVProduct] {
        let order: [Settle] = [.free, .door, .online, .table]
        return event.products.filter { tier?.includes($0) ?? true }.sorted {
            let a = order.firstIndex(of: $0.settle) ?? 9, b = order.firstIndex(of: $1.settle) ?? 9
            return a == b ? $0.price < $1.price : a < b
        }
    }

    var body: some View {
        ZStack {
            Self.ink.ignoresSafeArea()
            VStack(spacing: 0) {
                Rectangle().fill(accent).frame(height: 2)
                if let seller {
                    SupplierMark(brand: seller, height: 22, tint: accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                } else {
                    Color.clear.frame(height: 22).padding(.vertical, 18)
                }
                if let fuocoBooked {
                    fuocoBookedStep(fuocoBooked)
                } else if let confirmed {
                    passStep(confirmed)
                } else {
                    review
                }
            }
        }
        // The background runner's page sits here at FULL opacity, under the
        // opaque sheet colour (a near-transparent web view is treated as
        // hidden by iOS, which throttles the scripts Fourvenues' form needs).
        // In a background so its phone-sized frame never sizes the sheet: as
        // a ZStack child it made the sheet taller than a small iPhone's and
        // pushed the top of the sheet up under the grabber.
        .background(alignment: .topLeading) {
            if let runner {
                FVHiddenWeb(webView: runner.webView)
                    .frame(width: 390, height: 844)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .presentationDetents([.large])
        .cfSheetGrabber()
        .interactiveDismissDisabled(working)
        .onAppear {
            // VIP opens on the whole-venue map with nothing chosen — unless
            // the guest came for a specific area.
            if selected == nil, !(tier == .vip && initial == nil && !mappedZones.isEmpty) {
                let pick = (initial.flatMap { i in event.products.first { $0.id == i.id } } ?? initial)
                    ?? waysIn.first { !$0.soldOut }
                if let pick, !pick.soldOut { choose(pick) }
            }
            preload()
        }
        .task {
            let fallback = auth.profile?.email ?? auth.user?.email ?? ""
            ticketEmail = await FVInbox.email(api: api, userId: auth.user?.id.uuidString, fallback: fallback)
        }
        .onChange(of: selected) { _, _ in preload() }
        .onChange(of: quantity) { _, _ in preload() }
        .onChange(of: rate) { _, _ in payInFull = false; preload() }
        .fullScreenCover(item: $checkout) { target in
            FVCheckoutView(url: target.url, title: event.name ?? "Checkout",
                           paymentExpected: target.paymentExpected,
                           prefill: target.paymentExpected ? nil : account,
                           onTicket: { pdf in
                Task { await capture(pdf: pdf, product: target.product, heads: target.heads, unitPrice: target.unitPrice, paidNow: target.paidNow) }
            }, onPaidWithoutTicket: {
                // Paid, no PDF: file it now without a QR. Fourvenues' email
                // reaches the ticket inbox, which fills the QR in — the pass
                // step waits for it exactly as it does for a guestlist.
                let t = issue(product: target.product, heads: target.heads, unitPrice: target.unitPrice, pdf: nil, qr: nil)
                if let paidNow = target.paidNow { FVTicketStore.shared.update(t.id) { $0.paidNow = paidNow } }
            })
        }
    }

    private func choose(_ p: FVProduct) {
        selected = p
        rate = p.rates?.first
        quantity = max(1, p.min ?? 1)
        if let rate { quantity = Self.snap(quantity, to: rate.sizes) }
        errorText = nil
    }

    /// The allowed size nearest to `n`, preferring the larger on a tie — so a
    /// group of 3 picking a "4, 5 or 6" pool bed lands on 4, not nothing.
    static func snap(_ n: Int, to sizes: [Int]) -> Int {
        guard !sizes.contains(n), let best = sizes.min(by: {
            let a = abs($0 - n), b = abs($1 - n)
            return a == b ? $0 > $1 : a < b
        }) else { return n }
        return best
    }

    // ── Review ────────────────────────────────────────────────────────────────

    private var review: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(kicker.uppercased())
                    .font(.cfMono(10)).kerning(2.2)
                    .foregroundStyle(selected?.settle == .door ? Theme.ember : Self.text.opacity(0.7))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, 18)

                titleBlock

                if rooms.count > 1 { roomPicker.padding(.top, 18) }

                waysCard.padding(.top, rooms.count > 1 ? 12 : 22)

                // VIP: the whole venue first, nothing selected; tapping an area
                // zooms onto it and picks it.
                if tier == .vip || selected?.settle == .table, !mappedZones.isEmpty {
                    FVVenueMap(
                        layout: event.vipMap,
                        zones: mappedZones,
                        selected: selected?.settle == .table ? selected : nil,
                        selectedRate: rate?.id,
                        onSelectZone: { z in
                            if let z { choose(z) } else { selected = nil; rate = nil; quote = nil }
                        },
                        onPickTable: { space in
                            // A table picks its price, and a group that fits it.
                            guard let p = selected,
                                  let r = p.rates?.first(where: { space.rates.contains($0.id) }) else { return }
                            withAnimation(.snappy(duration: 0.2)) {
                                rate = r
                                let fit = space.cap.map { min(quantity, $0) } ?? quantity
                                quantity = Self.snap(max(fit, 1), to: r.sizes)
                            }
                        }
                    )
                    .padding(.top, 12)
                    if selected?.settle == .table {
                        Text(locale.t("fv.mapHint"))
                            .font(.cfSans(11))
                            .foregroundStyle(Self.text.opacity(0.5))
                            .padding(.top, 6)
                    }
                }

                if let p = selected, p.settle == .table, let rates = p.rates, rates.count > 1 {
                    rateChips(rates).padding(.top, 12)
                }

                if let p = selected { detailsCard(p).padding(.top, 14) }

                if let p = selected, p.settle == .door { doorBanner(p).padding(.top, 14) }

                if let p = selected { stepper(p).padding(.top, 16) }

                // The hourly feed has stalled: what's shown may have sold out.
                // Fourvenues is still asked live at the tap.
                if FVCatalog.shared.isStale, let at = FVCatalog.shared.publishedAt {
                    Text(String(format: locale.t("fv.feedStale"), at.formatted(date: .omitted, time: .shortened)))
                        .font(.cfSans(11))
                        .foregroundStyle(Self.text.opacity(0.5))
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.top, 10)
                }

                if let errorText {
                    Text(errorText)
                        .font(.cfSans(12))
                        .foregroundStyle(Color.adaptive(light: 0x8C2A2A, dark: 0xFFB4A2))
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.top, 12)
                }

                if needsPhoneField {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(locale.t("fv.phoneLabel"))
                            .font(.cfSans(12)).foregroundStyle(Self.text.opacity(0.55))
                        TextField("+34 612 345 678", text: $phoneInput)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .font(.cfSans(16))
                            .foregroundStyle(Self.text)
                            .padding(.horizontal, 14).frame(height: 46)
                            .background(Self.veil(0.05), in: .rect(cornerRadius: 12))
                            .onChange(of: phoneInput) { _, v in UserDefaults.standard.set(v, forKey: FVTicketStore.phoneKey) }
                        // Typed, but not a number Fourvenues will take.
                        if !phoneInput.isEmpty && phone == nil {
                            Text(locale.t("fv.phoneHint"))
                                .font(.cfSans(11))
                                .foregroundStyle(Color.adaptive(light: 0x8C2A2A, dark: 0xFFB4A2))
                        }
                    }
                    .padding(.top, 16)
                }

                if let p = selected {
                    Button { Task { await go(p) } } label: { ctaLabel(p) }
                        .disabled(working || (p.settle == .table && rate == nil) || (needsPhoneField && phone == nil))
                        .padding(.top, 20)

                    // We accept Fourvenues' and the organiser's terms on the
                    // guest's behalf in both flows, so the notice shows for both.
                    // A Fuoco-checkout table never goes near Fourvenues.
                    if p.soldBy == nil {
                    Text(p.signsUpInBackground ? locale.t("fv.termsNote")
                         : locale.t("fv.termsNote") + " " + locale.t("fv.payNote"))
                        .font(.cfSans(11))
                        .foregroundStyle(Self.text.opacity(0.45))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                    }
                }

                if let seller {
                    HStack(spacing: 6) {
                        // A Fuoco-checkout table isn't sold via Fourvenues.
                        Text(locale.t(fuoco == nil ? "fv.credit" : "rumbalist.via"))
                            .font(.cfSans(11))
                            .foregroundStyle(Self.text.opacity(0.45))
                        SupplierMark(brand: seller, height: 11, animated: false, tint: accent)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 18)
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 28)
            // Never wider than the screen: a child that won't shrink then
            // clips on its own instead of shoving the whole sheet sideways.
            .containerRelativeFrame(.horizontal)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    /// One chip per room; switching keeps the guest on the same kind of
    /// entry (free stays free) in the new room.
    private var roomPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(rooms) { r in
                    let on = r.code == event.code
                    Button {
                        guard !on, !working else { return }
                        Haptics.tap()
                        let want = selected?.settle ?? .free
                        withAnimation(.snappy(duration: 0.2)) {
                            room = r
                            let pick = r.products.first { (tier?.includes($0) ?? ($0.settle == want)) && !$0.soldOut }
                                ?? r.products.first { (tier?.includes($0) ?? true) && !$0.soldOut }
                            if let pick { choose(pick) } else { selected = nil }
                        }
                    } label: {
                        Text(FVText.pretty(r.name) ?? "")
                            .font(.cfSans(13, weight: .medium))
                            .lineLimit(1)
                            .padding(.horizontal, 14).frame(height: 36)
                            .background(on ? Self.ctaFill : Self.veil(0.05), in: .capsule)
                            .foregroundStyle(on ? Self.ctaLabel : Self.text)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var kicker: String {
        switch selected?.settle {
        case .free: return locale.t("rumbalist.titleFree")
        case .door: return locale.t("fv.kickerDoor")
        case .online: return locale.t("fv.kickerTicket")
        case .table: return locale.t("rumbalist.titleVip")
        case nil: return locale.t("fv.waysIn")
        }
    }

    private var titleBlock: some View {
        HStack(alignment: .center, spacing: 14) {
            if let url = event.image.flatMap(URL.init(string:)) {
                CachedAsyncImage(url: url, targetWidth: 200) {
                    $0.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Self.veil(0.06) }
                .frame(width: 66, height: 88)
                .clipShape(.rect(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Self.veil(0.1)))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(event.venue ?? "")
                    .font(.cfSans(13))
                    .foregroundStyle(Self.text.opacity(0.55))
                    .lineLimit(1)
                Text(FVText.pretty(event.name) ?? "")
                    .font(.cfSerif(28, italic: true))
                    .foregroundStyle(Self.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text([FVFormat.night(event.night), event.doors].compactMap { $0 }.joined(separator: " · "))
                    .font(.cfMono(11)).kerning(0.6)
                    .foregroundStyle(Self.text.opacity(0.55))
            }
            Spacer(minLength: 0)
        }
    }

    /// Every way in, in three plain tiers so the difference reads at a glance:
    /// the free guestlist first (one tap), then paid entry — each saying what
    /// it includes — then VIP tables.
    private var waysCard: some View {
        let tiers: [(String, [FVProduct])] = [
            (locale.t("fv.sectionFree"), waysIn.filter { $0.settle == .free }),
            (locale.t("fv.sectionAdmission"), waysIn.filter { $0.settle == .online || $0.settle == .door }),
            (locale.t("fv.sectionVip"), waysIn.filter { $0.settle == .table }),
        ]
        return VStack(alignment: .leading, spacing: 14) {
            ForEach(tiers.filter { !$0.1.isEmpty }, id: \.0) { title, products in
                VStack(alignment: .leading, spacing: 7) {
                    // One tier (opened from its own button) needs no heading.
                    if tier == nil {
                        Text(title.uppercased())
                            .font(.cfMono(10)).kerning(1.6)
                            .foregroundStyle(Self.text.opacity(0.55))
                            .padding(.leading, 4)
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(products.enumerated()), id: \.element.id) { i, p in
                            if i > 0 { Rectangle().fill(Self.veil(0.08)).frame(height: 1) }
                            wayRow(p)
                        }
                    }
                    .padding(.horizontal, 14)
                    .background(Self.veil(0.05), in: .rect(cornerRadius: 14))
                }
            }
        }
    }

    /// "Includes 1 drink + 1 shot", "Entry only", "Entry before 01:00".
    private func perksLine(_ p: FVProduct) -> (what: String?, when: String?) {
        let k = p.perks
        var items: [String] = []
        if k.openBar { items.append(locale.t("fv.perkOpenBar")) }
        if k.drinks > 0 { items.append(k.drinks == 1 ? locale.t("fv.perkDrink") : String(format: locale.t("fv.perkDrinks"), k.drinks)) }
        if k.shots > 0 { items.append(k.shots == 1 ? locale.t("fv.perkShot") : String(format: locale.t("fv.perkShots"), k.shots)) }
        if k.beerOrSoft { items.append(locale.t("fv.perkBeer")) }
        if k.bottle { items.append(locale.t("fv.perkBottle")) }
        let what: String? = switch p.settle {
        case .table: nil
        case .free: items.isEmpty ? nil : String(format: locale.t("fv.perkIncludes"), items.joined(separator: " + "))
        case .online, .door: items.isEmpty ? locale.t("fv.perkEntryOnly")
            : String(format: locale.t("fv.perkIncludes"), items.joined(separator: " + "))
        }
        // The guestlist's own window first — it's data, not a guess from the name.
        let when: String? = if let w = p.window, let f = w.from, let u = w.until { String(format: locale.t("fv.perkWindow"), f, u) }
            else if let u = p.window?.until { String(format: locale.t("fv.perkBefore"), u) }
            else if let f = p.window?.from { String(format: locale.t("fv.perkFrom"), f) }
            else if let w = k.window { String(format: locale.t("fv.perkWindow"), w.0, w.1) }
            else if let b = k.before { String(format: locale.t("fv.perkBefore"), b) }
            else { nil }
        return (what, when)
    }

    private func wayRow(_ p: FVProduct) -> some View {
        let on = selected?.id == p.id
        return Button {
            guard !p.soldOut, !working else { return }
            Haptics.tap()
            withAnimation(.snappy(duration: 0.2)) { choose(p) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(on ? accent : Self.text.opacity(0.3))
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(FVText.pretty(p.title(locale.locale)) ?? locale.t("rumbalist.titleFree"))
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(Self.text)
                        .multilineTextAlignment(.leading)
                    // A table a ranked promoter sells tonight on Fuoco checkout
                    // carries their mark, so it never reads as the night's own.
                    if let s = p.soldBy {
                        SupplierMark(brand: s.brand, height: 10, animated: false,
                                     tint: Color(hexString: s.brand.color) ?? Theme.ember)
                    }
                    let perks = perksLine(p)
                    if perks.what != nil || perks.when != nil {
                        Text([perks.what, perks.when].compactMap { $0 }.joined(separator: " · "))
                            .font(.cfSans(12, weight: .medium))
                            .foregroundStyle(p.settle == .free ? accent : Self.text.opacity(0.8))
                            .multilineTextAlignment(.leading)
                    }
                    if let d = p.info(locale.locale), !d.isEmpty {
                        Text(d.replacingOccurrences(of: "\n", with: " "))
                            .font(.cfSans(12))
                            .foregroundStyle(Self.text.opacity(0.55))
                            .lineLimit(on ? 4 : 1)
                            .multilineTextAlignment(.leading)
                    }
                    if p.fewLeft == true && !p.soldOut {
                        Text(locale.t("fv.fewLeft").uppercased())
                            .font(.cfMono(9)).kerning(1).foregroundStyle(Theme.ember)
                    }
                }
                Spacer(minLength: 8)
                priceLabel(p)
            }
            .padding(.vertical, 13)
            .contentShape(Rectangle())
            .opacity(p.soldOut ? 0.4 : 1)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func priceLabel(_ p: FVProduct) -> some View {
        if p.soldOut {
            Text(locale.t("fv.soldOut").uppercased())
                .font(.cfMono(10)).kerning(1).foregroundStyle(Self.text.opacity(0.5))
        } else {
            switch p.settle {
            case .free:
                Text(locale.t("rumbalist.free"))
                    .font(.cfSans(13, weight: .semibold)).foregroundStyle(accent)
            case .door:
                VStack(alignment: .trailing, spacing: 0) {
                    Text(p.price.euros).font(.cfSans(13, weight: .semibold)).foregroundStyle(Theme.ember)
                    Text(locale.t("fv.atDoor")).font(.cfMono(9)).foregroundStyle(Theme.ember)
                }
            case .online:
                Text(p.price.euros).font(.cfSans(13, weight: .semibold)).foregroundStyle(Self.text)
            case .table:
                VStack(alignment: .trailing, spacing: 0) {
                    Text(locale.t("fv.from")).font(.cfMono(9)).foregroundStyle(Self.text.opacity(0.5))
                    Text(p.price > 0 ? p.price.euros : "—").font(.cfSans(13, weight: .semibold)).foregroundStyle(Self.text)
                }
            }
        }
    }

    private func payChoice(_ label: String, full: Bool) -> some View {
        let on = payInFull == full
        return Button {
            Haptics.tap()
            payInFull = full
        } label: {
            Text(label)
                .font(.cfSans(13, weight: .medium))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity).frame(height: 36)
                .background(on ? Self.ctaFill : Self.veil(0.05), in: .capsule)
                .foregroundStyle(on ? Self.ctaLabel : Self.text)
        }
        .buttonStyle(.plain)
    }

    private func rateChips(_ rates: [FVRate]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(rates) { r in
                    let on = rate?.id == r.id
                    Button {
                        Haptics.tap(); rate = r
                        quantity = Self.snap(quantity, to: r.sizes)
                    } label: {
                        Text([r.title(locale.locale), r.price.euros, r.pax.flatMap { $0.max() }.map { String(format: locale.t("fv.upTo"), $0) }]
                            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.cfSans(13, weight: .medium))
                            .padding(.horizontal, 14).frame(height: 36)
                            .background(on ? Self.ctaFill : Self.veil(0.05), in: .capsule)
                            .foregroundStyle(on ? Self.ctaLabel : Self.text)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func detailsCard(_ p: FVProduct) -> some View {
        VStack(spacing: 0) {
            row(locale.t("rumbalist.venue")) { Text(event.venue ?? "—") }
            if let a = event.address { row(locale.t("rumbalist.address"), small: true) { Text(a).opacity(0.7) } }
            row(locale.t("rumbalist.date")) { Text(FVFormat.night(event.night)) }
            if let doors = event.doors {
                row(locale.t("fv.doors")) { Text([doors, event.closes].compactMap { $0 }.joined(separator: " – ")) }
            }
            if let age = p.minAge ?? event.minAge { row(locale.t("fv.age")) { Text("\(age)+") } }
            if p.settle == .table, p.soldBy != nil, let rate {
                if let d = rate.info(locale.locale), !d.isEmpty { row(rate.title(locale.locale) ?? "", small: true) { Text(d).opacity(0.7) } }
                if fuocoModes.count > 1, let dep = rate.depositAmount {
                    HStack(spacing: 8) {
                        payChoice(String(format: locale.t("fv.payDeposit"), dep.euros), full: false)
                        payChoice(String(format: locale.t("fv.payFull"), rate.price.euros), full: true)
                    }
                    .accessibilityLabel(locale.t("fv.payChoice"))
                    .padding(.vertical, 8)
                    .disabled(working)
                }
            } else if p.settle == .table, let rate {
                if let d = rate.info(locale.locale), !d.isEmpty { row(rate.title(locale.locale) ?? "", small: true) { Text(d).opacity(0.7) } }
                if rate.offersFullPayment, let dep = quote?.deposit ?? rate.depositAmount {
                    let full = quote?.full ?? quote?.total ?? rate.price
                    // Two buttons, not a segmented Picker: UISegmentedControl
                    // won't shrink below its labels, and "Pay in full €1,240"
                    // made it wider than a small iPhone — the whole sheet then
                    // sat off-centre and panned sideways.
                    HStack(spacing: 8) {
                        payChoice(String(format: locale.t("fv.payDeposit"), dep.euros), full: false)
                        payChoice(String(format: locale.t("fv.payFull"), full.euros), full: true)
                    }
                    .accessibilityLabel(locale.t("fv.payChoice"))
                    .padding(.vertical, 8)
                    .disabled(working)
                } else if quote == nil, let dep = rate.depositLabel {
                    row(locale.t("fv.deposit")) { Text(dep) }
                }
            }
            Rectangle().fill(Self.veil(0.08)).frame(height: 1).padding(.vertical, 3)
            priceRows(p)
        }
        .padding(.init(top: 10, leading: 16, bottom: 10, trailing: 16))
        .background(Self.veil(0.05), in: .rect(cornerRadius: 14))
    }

    /// Subtotal, fees and the total actually charged — Fourvenues' figures
    /// once the page has reported them; our estimate (marked "+ fees") until.
    @ViewBuilder private func priceRows(_ p: FVProduct) -> some View {
        if p.settle == .table, p.soldBy != nil, let rate {
            let now = VipSellers.amount(rate, fuocoPay)
            row(locale.t("fv.tableTotal")) { Text(rate.price.euros) }
            row(locale.t("fv.payNow"), bold: true) { Text(now.euros) }
            if rate.price - now > 0.009 {
                row(locale.t("fv.restLater"), small: true) { Text((rate.price - now).euros).opacity(0.7) }
            }
        } else if p.settle == .table, let q = quote, let total = q.total {
            let canSplit = rate?.offersFullPayment == true || (q.deposit ?? total) < total
            let inFull = payInFull || !canSplit || q.deposit == nil
            let now = inFull ? (q.full ?? total) : (q.deposit ?? total)
            let fee = (inFull ? q.fullFee : q.depositFee) ?? 0
            row(locale.t("fv.tableTotal")) { Text(total.euros) }
            if !inFull { row(locale.t("fv.depositNow")) { Text(now.euros) } }
            row(locale.t("fv.fees")) { Text(fee.euros) }
            row(locale.t("fv.payNow"), bold: true) { Text((now + fee).euros) }
            if !inFull, total - now > 0.009 {
                row(locale.t("fv.restLater"), small: true) { Text((total - now).euros).opacity(0.7) }
            }
        } else if p.settle == .online, let q = quote, let total = q.total {
            row(locale.t("fv.subtotal")) { Text((q.subtotal ?? total - (q.fee ?? 0)).euros) }
            row(locale.t("fv.fees")) { Text((q.fee ?? 0).euros) }
            row(locale.t("rumbalist.total"), bold: true) { Text(total.euros) }
        } else if p.settle == .online || p.settle == .table {
            row(locale.t("rumbalist.total"), bold: true) {
                Text(totalText(p) + " " + locale.t("fv.plusFees")).opacity(0.85)
            }
        } else {
            row(locale.t("rumbalist.total"), bold: true) { Text(totalText(p)) }
        }
    }

    private func totalText(_ p: FVProduct) -> String {
        switch p.settle {
        case .free: return locale.t("rumbalist.free")
        case .door: return String(format: locale.t("fv.atDoorAmount"), (p.price * Double(quantity)).euros)
        case .online: return (p.price * Double(quantity)).euros
        case .table: return (rate?.price ?? p.price).euros
        }
    }

    private func row(_ label: String, small: Bool = false, bold: Bool = false,
                     @ViewBuilder value: () -> some View) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.cfSans(small ? 11 : 12))
                .foregroundStyle(Self.text.opacity(0.5))
            Spacer(minLength: 16)
            value()
                .font(.cfSans(small ? 11 : 13, weight: bold ? .bold : .regular))
                .foregroundStyle(Self.text)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 7)
    }

    private func doorBanner(_ p: FVProduct) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "eurosign.circle.fill").font(.system(size: 24))
            VStack(alignment: .leading, spacing: 2) {
                Text(String(format: locale.t("fv.payAtDoorTitle"), (p.price * Double(quantity)).euros))
                    .font(.cfSans(15, weight: .bold))
                Text(String(format: locale.t("fv.payAtDoorNote"), p.price.euros))
                    .font(.cfSans(12))
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(14)
        .background(Theme.ember, in: .rect(cornerRadius: 14))
    }

    private func stepper(_ p: FVProduct) -> some View {
        // Tables step through the rate's own allowed sizes; everything else
        // through the product's min…max per order.
        let sizes = p.settle == .table
            ? (rate?.sizes ?? Array(1...10))
            : Array(max(1, p.min ?? 1)...max(max(1, p.min ?? 1), p.maxPerOrder))
        let lower = sizes.last { $0 < quantity }
        let higher = sizes.first { $0 > quantity }
        return HStack {
            Text(locale.t(p.settle == .table ? "fv.groupSize" : "fv.people"))
                .font(.cfSans(15, weight: .medium))
                .foregroundStyle(Self.text)
            Spacer()
            HStack(spacing: 14) {
                stepButton("minus", enabled: lower != nil) { if let lower { quantity = lower } }
                Text("\(quantity)")
                    .font(.cfMono(17, weight: .medium))
                    .foregroundStyle(Self.text)
                    .frame(minWidth: 28)
                stepButton("plus", enabled: higher != nil) { if let higher { quantity = higher } }
            }
        }
    }

    private func stepButton(_ icon: String, enabled: Bool, _ act: @escaping () -> Void) -> some View {
        Button { guard enabled, !working else { return }; Haptics.tap(); act() } label: {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Self.text)
                .frame(width: 34, height: 34)
                .overlay(Circle().stroke(Self.veil(0.18)))
        }
        .opacity(enabled ? 1 : 0.35)
    }

    /// A saved table sold by a promoter on Fuoco checkout: the server prices it
    /// from the catalog (create-vip-intent checks seller, rate, party, deposit
    /// or full, and the amount), Apple Pay confirms, confirm-vip books it.
    private func payFuoco(_ p: FVProduct, seller s: VipSellers.Seller) async {
        guard let rate, let zone = p.name else { return }
        let pay = fuocoPay
        let amount = VipSellers.amount(rate, pay)
        working = true
        defer { working = false }
        do {
            struct Table: Encodable { let zone: String; let rate: String; let pax: Int; let pay: String }
            struct IntentBody: Encodable {
                let clubId: String; let amount: Int; let bookingDate: String
                let venueName: String; let table: Table
            }
            struct IntentResult: Decodable, Sendable { let clientSecret: String; let paymentIntentId: String }
            guard let clubId = event.clubId else { return }
            let intent: IntentResult = try await api.post(
                "/api/rumbalist/create-vip-intent",
                body: IntentBody(clubId: clubId, amount: Int((amount * 100).rounded()), bookingDate: event.night,
                                 venueName: event.venue ?? "",
                                 table: Table(zone: zone, rate: rate.id, pax: quantity, pay: pay.rawValue)))
            try await ApplePayService.confirmIntent(amount: amount, label: event.venue ?? s.brandName,
                                                    clientSecret: intent.clientSecret)
            struct ConfirmBody: Encodable {
                let paymentIntentId: String; let clubId: String; let venueName: String
                let productName: String; let bookingDate: String
            }
            let result: RumbalistBookingResult = try await api.post(
                "/api/rumbalist/confirm-vip",
                body: ConfirmBody(paymentIntentId: intent.paymentIntentId, clubId: clubId,
                                  venueName: event.venue ?? "",
                                  productName: [p.title(locale.locale), rate.title(locale.locale)]
                                    .compactMap { $0 }.joined(separator: " · "),
                                  bookingDate: event.night))
            Haptics.success()
            fuocoBooked = result
        } catch let error as ApplePayError where error == .cancelled {
            // Closed the Apple Pay sheet — nothing charged.
        } catch {
            Haptics.error()
            errorText = error.localizedDescription
        }
    }

    private func fuocoBookedStep(_ r: RumbalistBookingResult) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 44)).foregroundStyle(accent)
            Text(locale.t("rumbalist.tableBooked"))
                .font(.cfSerif(28, italic: true)).foregroundStyle(Self.text)
            VStack(spacing: 0) {
                row(locale.t("rumbalist.venue")) { Text(event.venue ?? "—") }
                row(locale.t("rumbalist.date")) { Text(FVFormat.night(event.night)) }
                if let p = selected { row(locale.t("rumbalist.offer")) { Text(p.title(locale.locale) ?? "") } }
                if let ref = r.qrCodeToken { row(locale.t("rumbalist.reference")) { Text(ref).font(.cfMono(13)) } }
            }
            .padding(.init(top: 10, leading: 16, bottom: 10, trailing: 16))
            .background(Self.veil(0.05), in: .rect(cornerRadius: 14))
            Text(locale.t("rumbalist.savedToTickets"))
                .font(.cfSans(12)).foregroundStyle(Self.text.opacity(0.55))
                .multilineTextAlignment(.center)
            Button { dismiss() } label: {
                Text(locale.t("common.done"))
                    .font(.cfSans(16, weight: .semibold)).foregroundStyle(Self.ctaLabel)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(Self.ctaFill, in: .rect(cornerRadius: 12))
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
    }

    private func ctaLabel(_ p: FVProduct) -> some View {
        HStack(spacing: 8) {
            if working {
                ProgressView().tint(Self.ctaLabel)
                Text(locale.t(p.signsUpInBackground ? "fv.joining" : "fv.opening"))
            } else {
                switch p.settle {
                case .free:
                    Text(locale.t("rumbalist.freeGuestlist"))
                case .door:
                    Text(String(format: locale.t("fv.ctaDoor"), (p.price * Double(quantity)).euros))
                case .online:
                    let c = chargeNow(p)
                    Image(systemName: "lock.fill").font(.system(size: 13))
                    Text(String(format: locale.t("fv.ctaPay"), c.amount.euros) + (c.exact ? "" : " " + locale.t("fv.plusFees")))
                case .table:
                    let c = chargeNow(p)
                    Image(systemName: "lock.fill").font(.system(size: 13))
                    Text(String(format: locale.t("fv.ctaTable"), c.amount.euros) + (c.exact ? "" : " " + locale.t("fv.plusFees")))
                }
            }
        }
        .font(.cfSans(16, weight: .semibold))
        .foregroundStyle(p.settle == .door ? .white : Self.ctaLabel)
        .frame(maxWidth: .infinity)
        .frame(height: 54)
        .background(p.settle == .door ? Theme.ember : Self.ctaFill, in: .rect(cornerRadius: 12))
        .opacity(working ? 0.7 : 1)
    }

    // ── Pass ──────────────────────────────────────────────────────────────────

    /// Until the QR is here the guest sees only "give us a second" — never a
    /// placeholder QR, and never anything on Fourvenues. A guestlist sign-up's
    /// reply carries no door code (just _id/purchase_id), so the QR always
    /// comes the other way: Fourvenues' email → ticket inbox → the account,
    /// ~5 s after joining. waitForQR pulls the account until it lands.
    private func passStep(_ issued: FVTicket) -> some View {
        // Follow the store, so the QR shows the moment sync brings it.
        let t = FVTicketStore.shared.tickets.first { $0.id == issued.id } ?? issued
        return ScrollView {
            Group {
                if let qr = t.qrPayload {
                    ticketReady(t, qr: qr)
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                } else {
                    gettingTicket(t)
                        .transition(.opacity)
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 28)
        }
        .animation(.snappy(duration: 0.35), value: t.qrPayload)
        .task(id: t.id) { await waitForQR(t.id) }
    }

    private func gettingTicket(_ t: FVTicket) -> some View {
        VStack(spacing: 16) {
            Group {
                if waitedOut {
                    Image(systemName: "clock").font(.system(size: 34)).foregroundStyle(accent)
                } else {
                    ProgressView().controlSize(.large).tint(accent)
                }
            }
            .frame(height: 48)
            .padding(.top, 40)
            Text(locale.t("fv.gettingTicket"))
                .font(.cfSerif(26, italic: true))
                .foregroundStyle(Self.text)
                .multilineTextAlignment(.center)
            Text(locale.t(waitedOut ? "fv.ticketSlow" : "fv.gettingTicketNote"))
                .font(.cfSans(13))
                .foregroundStyle(Self.text.opacity(0.6))
                .multilineTextAlignment(.center)
            eventLine(t).padding(.top, 8)
            // They may leave: the ticket is on the account and lands in
            // Tickets (with a push) whether or not this screen is open.
            Button { dismiss() } label: {
                Text(locale.t("fv.done"))
                    .font(.cfSans(15, weight: .medium))
                    .foregroundStyle(Self.text)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Self.veil(0.18)))
                    .contentShape(.rect(cornerRadius: 12))
            }
            .padding(.top, 24)
        }
    }

    private func ticketReady(_ t: FVTicket, qr: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 40))
                .foregroundStyle(accent)
            Text(locale.t(t.settle == Settle.online.rawValue ? "fv.youreIn" : "rumbalist.onDoorList"))
                .font(.cfSerif(26, italic: true))
                .foregroundStyle(Self.text)
                .multilineTextAlignment(.center)
            HStack(spacing: 6) {
                Image(systemName: "ticket.fill").font(.system(size: 11))
                Text(locale.t("rumbalist.savedToTickets")).font(.cfSans(11))
            }
            .foregroundStyle(Self.text.opacity(0.55))

            eventLine(t)

            VStack(spacing: 8) {
                QRCodeView(token: qr).frame(width: 200, height: 200)
                Text(qr).font(.cfMono(13, weight: .semibold)).foregroundStyle(Theme.onQRSurface)
            }
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(Theme.qrSurface, in: .rect(cornerRadius: 18))

            if let sid = FVTicketStore.shared.tickets.first(where: { $0.id == t.id })?.serverId ?? t.serverId {
                WalletPassButton(passPath: "/api/external-tickets/\(sid.uuidString.lowercased())/wallet",
                                 fullWidth: true)
            }

            if let owed = t.owedAtDoor {
                HStack(spacing: 10) {
                    Image(systemName: "eurosign.circle.fill").font(.system(size: 20))
                    Text(String(format: locale.t("fv.payAtDoorTitle"), owed.euros))
                        .font(.cfSans(14, weight: .bold))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white)
                .padding(14)
                .background(Theme.ember, in: .rect(cornerRadius: 14))
            }

            // No "View ticket": this screen IS the ticket — the QR above is what
            // the door scans, and the Tickets tab holds the same card later.
            Button { dismiss() } label: {
                Text(locale.t("fv.done"))
                    .font(.cfSans(16, weight: .semibold))
                    .foregroundStyle(Self.ctaLabel)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(Self.ctaFill, in: .rect(cornerRadius: 12))
            }
        }
    }

    private func eventLine(_ t: FVTicket) -> some View {
        Text("\(FVText.pretty(t.eventName) ?? "") · \(t.venue ?? "")\n\(FVFormat.night(t.night))\(t.doors.map { " · \($0)" } ?? "")")
            .font(.cfSans(13))
            .foregroundStyle(Self.text.opacity(0.7))
            .multilineTextAlignment(.center)
    }

    /// Pull the account until the QR arrives: every 2 s for 90 s. The inbox
    /// files it ~4 s after the sign-up; past 90 s something upstream is slow,
    /// and the screen says the ticket will land in Tickets instead.
    private func waitForQR(_ id: UUID) async {
        let store = FVTicketStore.shared
        let started = Date()
        while !Task.isCancelled {
            if store.tickets.first(where: { $0.id == id })?.qrPayload != nil {
                Haptics.success()
                return
            }
            if Date().timeIntervalSince(started) > 90 {
                FVTrace.log("qr wait: not here after 90s")
                waitedOut = true
                return
            }
            await FVAccountSync.sync(auth.queries.supabaseService)
            try? await Task.sleep(for: .seconds(2))
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private func go(_ p: FVProduct) async {
        errorText = nil
        Haptics.tap()
        if p.settle == .table, let s = p.soldBy {
            if FVAge.tooYoung(birthday: auth.profile?.birthday, minAge: p.minAge ?? event.minAge, night: event.night) {
                errorText = String(format: locale.t("fv.underAge"), p.minAge ?? event.minAge ?? 18)
                return
            }
            await payFuoco(p, seller: s)
            return
        }
        if let why = blocker(p) {
            errorText = why
            return
        }
        if p.settle == .table || p.settle == .online {
            let formURL: URL?
            let unit: Double
            if p.settle == .table {
                guard let rate else { return }
                formURL = p.tableURL(rate: rate, pax: quantity); unit = quote?.total ?? rate.price
            } else {
                formURL = p.checkoutURL(quantity: quantity); unit = p.price
            }
            guard let formURL else { return }
            // Fill Fourvenues' details form in the hidden page — name, email,
            // confirm email, phone, the two required terms — and press Proceed
            // to payment there. Only the payment page itself is shown, in a
            // fresh web view with no script run in it, so Apple Pay works.
            guard let (name, email) = account else {
                errorText = locale.t("fv.needsProfile")
                return
            }
            guard let phone else {
                errorText = locale.t("fv.phoneHint")
                return
            }
            let r = runner ?? FVFormRunner()
            runner = r
            working = true
            FVTrace.log("pay tapped (\(event.code))")
            do {
                var extras = FVAttendee(profile: auth.profile)
                extras.fullPayment = p.settle == .table && payInFull && rate?.offersFullPayment == true
                if p.settle == .table { FVTrace.log("table payment: \(extras.fullPayment ? "in full" : "deposit")") }
                let pay = try await r.payURL(url: formURL, name: name, email: email, phone: phone, extras: extras)
                working = false
                // A table on deposit: remember what was paid now, so the ticket
                // shows the balance due at the venue.
                let paidNow = p.settle == .table && !extras.fullPayment ? (quote?.deposit ?? rate?.depositAmount) : nil
                checkout = CheckoutTarget(url: pay, product: p, heads: quantity, unitPrice: unit,
                                          paymentExpected: true, paidNow: paidNow)
            } catch FVFormRunner.Failure.rejected(let why) {
                working = false
                await refused(why)
            } catch {
                // Never hand the guest Fourvenues' details form — say so in
                // ours; the trace names the field that blocked it.
                FVTrace.log("background details failed: \(error)")
                working = false
                errorText = locale.t("fv.cantComplete")
            }
            return
        }
        guard let url = p.checkoutURL(quantity: quantity) else { return }

        guard let (name, email) = account else {
            // Nothing to fill with. A guestlist never sends the guest to
            // Fourvenues — ask for the name in our own UI instead.
            FVTrace.log("no account name/email — asking for profile")
            errorText = locale.t("fv.needsProfile")
            return
        }

        let r = runner ?? FVFormRunner()
        runner = r
        working = true
        FVTrace.log("join tapped (\(event.code))")
        do {
            try await r.submit(url: url, name: name, email: email, phone: phone,
                               extras: FVAttendee(profile: auth.profile), eventCode: event.code)
        } catch FVFormRunner.Failure.sentUnconfirmed {
            // Sent, but Fourvenues never answered. Don't issue a ticket on a
            // guess — a refused list looks just like this. If it did go
            // through, their email reaches the ticket inbox, which files the
            // ticket on the account and the next sync brings it to the phone.
            FVTrace.log("sent, unconfirmed — no ticket issued; locked 10 min")
            working = false
            FVUnconfirmedLock.lock(p.id)
            errorText = locale.t("fv.unconfirmed")
            return
        } catch FVFormRunner.Failure.rejected(let why) {
            FVTrace.log("rejected by Fourvenues")
            working = false
            await refused(why)
            return
        } catch {
            // Never hand the guest Fourvenues' form — say so in ours; the
            // trace names the field that blocked it.
            FVTrace.log("background sign-up failed: \(error)")
            working = false
            errorText = locale.t("fv.cantComplete")
            return
        }
        // Fourvenues accepted it — the guest is on the list. The door code
        // comes from their own answer to the sign-up, so the QR is there now.
        working = false
        let code = r.confirmation?.ticketCode
        FVTrace.log("joined — ticket issued (qr \(code != nil ? "from response" : "pending"))")
        let t = issue(product: p, heads: quantity, unitPrice: p.price, pdf: r.confirmation?.pdfURL, qr: code)
        FVTicketStore.shared.update(t.id) { $0.successURL = r.successURL.map(Self.standalone)?.absoluteString }
        // Response had a PDF but no recognisable code: read it off the PDF.
        if code == nil, let pdf = r.confirmation?.pdfURL {
            Task {
                let read = try? await FVTicketReader.read(pdfURL: pdf)
                FVTicketStore.shared.update(t.id) { $0.qrPayload = read?.qrPayload }
            }
        }
    }

    /// Fourvenues said no: show our sentence for it, never their page text, and
    /// act on what it means (sold out → fresh feed; already on → their ticket).
    private func refused(_ raw: String) async {
        FVTrace.log("refusal: \(raw.prefix(200))")
        let key = FVReject.key(for: raw)
        errorText = locale.t(key)
        switch key {
        case "fv.justSoldOut":
            await FVCatalog.shared.refresh(force: true)
        case "fv.alreadyOnList":
            await FVAccountSync.sync(auth.queries.supabaseService)
        default:
            break
        }
    }

    /// Their success URL without `iframe=1`, so it behaves as a normal page
    /// (Download opens the PDF instead of messaging a parent site).
    static func standalone(_ url: URL) -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.queryItems = parts.queryItems?.filter { $0.name != "iframe" }
        if parts.queryItems?.isEmpty == true { parts.queryItems = nil }
        return parts.url ?? url
    }

    /// Warm the hidden page for the free/door product the guest has selected,
    /// so tapping Join only has to fill and submit.
    private func preload() {
        // A Fuoco-checkout table never touches Fourvenues' pages.
        guard let p = selected, p.soldBy == nil else { quote = nil; return }
        let url: URL? = p.settle == .table
            ? rate.flatMap { p.tableURL(rate: $0, pax: quantity) }
            : p.checkoutURL(quantity: quantity)
        guard let url else { return }
        let r = runner ?? FVFormRunner()
        runner = r
        r.preload(url)
        // Paid ways in: read the real price summary (fees, per-person table
        // supplements) off the page as soon as it has loaded.
        guard p.settle == .online || p.settle == .table else { quote = nil; return }
        if quote != nil { quote = nil }
        Task {
            let q = await r.quote(for: url)
            if r.loadedURL == url { quote = q }
        }
    }

    @discardableResult
    private func issue(product p: FVProduct, heads: Int, unitPrice: Double, pdf: URL?, qr: String?) -> FVTicket {
        let t = FVTicket(
            eventCode: event.code, eventName: event.name, venue: event.venue, address: event.address,
            night: event.night, doors: event.doors, closes: event.closes, image: event.image,
            productName: p.settle == .table ? "\(p.title(locale.locale) ?? "Table") · \(rate?.title(locale.locale) ?? "")"
                : p.title(locale.locale),
            settle: p.settle.rawValue, unitPrice: unitPrice, heads: heads,
            qrPayload: qr, pdfURL: pdf?.absoluteString)
        FVTicketStore.shared.add(t)
        FVTicketStore.shared.focus = .local(t.id)
        // Onto the account, so it follows the user to another phone and the
        // ticket inbox can fill in the QR when Fourvenues' email lands.
        Task { await FVAccountSync.sync(auth.queries.supabaseService) }
        // No success haptic here: it fires when the QR is in hand (waitForQR).
        confirmed = t
        return t
    }

    /// Paid checkout came back with the PDF: read the QR, then issue.
    private func capture(pdf: URL, product p: FVProduct, heads: Int, unitPrice: Double, paidNow: Double?) async {
        let read = try? await FVTicketReader.read(pdfURL: pdf)
        let t = issue(product: p, heads: heads, unitPrice: unitPrice, pdf: pdf, qr: read?.qrPayload)
        if let paidNow { FVTicketStore.shared.update(t.id) { $0.paidNow = paidNow } }
    }
}

struct FVPill: View {
    let text: String
    let fill: Color
    let ink: Color
    var body: some View {
        Text(text)
            .font(.cfMono(10, weight: .semibold)).kerning(0.8)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(fill, in: .capsule)
            .foregroundStyle(ink)
            .fixedSize()
    }
}

enum FVFormat {
    static func night(_ ymd: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        inF.timeZone = TimeZone(identifier: "Europe/Madrid")
        guard let d = inF.date(from: ymd) else { return ymd }
        let out = DateFormatter(); out.dateFormat = "EEE d MMM"
        out.timeZone = inF.timeZone
        return out.string(from: d)
    }
}
