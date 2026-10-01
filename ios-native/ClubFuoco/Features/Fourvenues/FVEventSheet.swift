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

    init(event: FVEvent, initial: FVProduct? = nil, rooms: [FVEvent] = []) {
        self.opened = event
        self.initial = initial
        self.rooms = rooms
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
    @State private var quantity = 1
    @State private var runner: FVFormRunner?
    @State private var working = false
    @State private var errorText: String?
    @State private var checkout: CheckoutTarget?
    @State private var confirmed: FVTicket?
    @State private var openTicket: FVTicket?
    /// Phone for paid checkouts when the profile has none — asked once, kept.
    @State private var phoneInput: String = UserDefaults.standard.string(forKey: "fv.phone") ?? ""
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
    private var accent: Color { Color(hexString: FVCatalog.brand.color) ?? Theme.ember }

    /// Name + email from the account, for filling Fourvenues' form.
    private var account: (name: String, email: String)? {
        let name = (auth.profile?.fullName ?? "").trimmingCharacters(in: .whitespaces)
        let email = ticketEmail ?? auth.profile?.email ?? auth.user?.email ?? ""
        return name.isEmpty || email.isEmpty ? nil : (name, email)
    }

    /// Phone in international form for Fourvenues' paid form: the profile's
    /// (with +34 assumed when it carries no country code), else what the
    /// guest typed here.
    private var phone: String? {
        let raw = (auth.profile?.phone?.isEmpty == false ? auth.profile?.phone : nil) ?? phoneInput
        let t = raw.trimmingCharacters(in: .whitespaces)
        let digits = t.filter(\.isNumber)
        guard digits.count >= 8 else { return nil }
        return t.hasPrefix("+") ? t : "+34 " + digits
    }

    private var needsPhoneField: Bool {
        guard let p = selected, p.settle == .online || p.settle == .table else { return false }
        return auth.profile?.phone?.filter(\.isNumber).count ?? 0 < 8
    }

    /// Every way in, cheapest-to-commit first: free, door, ticket, table.
    private var waysIn: [FVProduct] {
        let order: [Settle] = [.free, .door, .online, .table]
        return event.products.sorted {
            let a = order.firstIndex(of: $0.settle) ?? 9, b = order.firstIndex(of: $1.settle) ?? 9
            return a == b ? $0.price < $1.price : a < b
        }
    }

    var body: some View {
        ZStack {
            // The background runner's page sits here at FULL opacity, under the
            // opaque sheet colour. A near-transparent web view is treated as
            // hidden by iOS, which throttles the scripts Fourvenues' form needs.
            if let runner {
                FVHiddenWeb(webView: runner.webView)
                    .frame(width: 390, height: 844)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            Self.ink.ignoresSafeArea()
            VStack(spacing: 0) {
                Rectangle().fill(accent).frame(height: 2)
                SupplierMark(brand: FVCatalog.brand, height: 22, tint: accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                if let confirmed {
                    passStep(confirmed)
                } else {
                    review
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(working)
        .onAppear {
            if selected == nil {
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
                           prefill: target.paymentExpected ? nil : account) { pdf in
                Task { await capture(pdf: pdf, product: target.product, heads: target.heads, unitPrice: target.unitPrice, paidNow: target.paidNow) }
            }
        }
        .sheet(item: $openTicket) { FVTicketDetailView(ticket: $0, justIssued: false) }
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

                if let p = selected, p.settle == .table, let rates = p.rates, rates.count > 1 {
                    rateChips(rates).padding(.top, 12)
                }

                if let p = selected { detailsCard(p).padding(.top, 14) }

                if let p = selected, p.settle == .door { doorBanner(p).padding(.top, 14) }

                if let p = selected { stepper(p).padding(.top, 16) }

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
                            .onChange(of: phoneInput) { _, v in UserDefaults.standard.set(v, forKey: "fv.phone") }
                    }
                    .padding(.top, 16)
                }

                if let p = selected {
                    Button { Task { await go(p) } } label: { ctaLabel(p) }
                        .disabled(working || (p.settle == .table && rate == nil) || (needsPhoneField && phone == nil))
                        .padding(.top, 20)

                    // We accept Fourvenues' and the organiser's terms on the
                    // guest's behalf in both flows, so the notice shows for both.
                    Text(p.signsUpInBackground ? locale.t("fv.termsNote")
                         : locale.t("fv.termsNote") + " " + locale.t("fv.payNote"))
                        .font(.cfSans(11))
                        .foregroundStyle(Self.text.opacity(0.45))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                }

                HStack(spacing: 6) {
                    Text(locale.t("fv.credit"))
                        .font(.cfSans(11))
                        .foregroundStyle(Self.text.opacity(0.45))
                    SupplierMark(brand: FVCatalog.brand, height: 11, animated: false, tint: accent)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 18)
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 28)
        }
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
                            let pick = r.products.first { $0.settle == want && !$0.soldOut }
                                ?? r.products.first { !$0.soldOut }
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

    /// Every way in, as a radio list. Hidden behind a single row when the guest
    /// came for one thing and there's nothing else to choose between.
    private var waysCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(waysIn.enumerated()), id: \.element.id) { i, p in
                if i > 0 { Rectangle().fill(Self.veil(0.08)).frame(height: 1) }
                wayRow(p)
            }
        }
        .padding(.horizontal, 14)
        .background(Self.veil(0.05), in: .rect(cornerRadius: 14))
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
                    Text(FVText.pretty(p.name) ?? locale.t("rumbalist.titleFree"))
                        .font(.cfSans(14, weight: .semibold))
                        .foregroundStyle(Self.text)
                        .multilineTextAlignment(.leading)
                    if let d = p.detail, !d.isEmpty {
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

    private func rateChips(_ rates: [FVRate]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(rates) { r in
                    let on = rate?.id == r.id
                    Button {
                        Haptics.tap(); rate = r
                        quantity = Self.snap(quantity, to: r.sizes)
                    } label: {
                        Text([r.name, r.price.euros, r.pax.flatMap { $0.max() }.map { String(format: locale.t("fv.upTo"), $0) }]
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
            if p.settle == .table, let rate {
                if let d = rate.description, !d.isEmpty { row(rate.name ?? "", small: true) { Text(d).opacity(0.7) } }
                if rate.offersFullPayment, let dep = rate.depositAmount {
                    Picker(locale.t("fv.payChoice"), selection: $payInFull) {
                        Text(String(format: locale.t("fv.payDeposit"), dep.euros)).tag(false)
                        Text(String(format: locale.t("fv.payFull"), rate.price.euros)).tag(true)
                    }
                    .pickerStyle(.segmented)
                    .padding(.vertical, 8)
                    .disabled(working)
                    if !payInFull {
                        row(locale.t("fv.restLater"), small: true) { Text((rate.price - dep).euros).opacity(0.7) }
                    }
                } else if let dep = rate.depositLabel {
                    row(locale.t("fv.deposit")) { Text(dep) }
                }
            }
            Rectangle().fill(Self.veil(0.08)).frame(height: 1).padding(.vertical, 3)
            row(locale.t("rumbalist.total"), bold: true) { Text(totalText(p)) }
        }
        .padding(.init(top: 10, leading: 16, bottom: 10, trailing: 16))
        .background(Self.veil(0.05), in: .rect(cornerRadius: 14))
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
                    Image(systemName: "lock.fill").font(.system(size: 13))
                    Text(String(format: locale.t("fv.ctaPay"), (p.price * Double(quantity)).euros))
                case .table:
                    Image(systemName: "lock.fill").font(.system(size: 13))
                    Text(String(format: locale.t("fv.ctaTable"), (rate?.price ?? p.price).euros))
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

    private func passStep(_ issued: FVTicket) -> some View {
        // Follow the store, so a QR that lands a beat later shows up here.
        let t = FVTicketStore.shared.tickets.first { $0.id == issued.id } ?? issued
        return ScrollView {
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

                Text("\(FVText.pretty(t.eventName) ?? "") · \(t.venue ?? "")\n\(FVFormat.night(t.night))\(t.doors.map { " · \($0)" } ?? "")")
                    .font(.cfSans(13))
                    .foregroundStyle(Self.text.opacity(0.7))
                    .multilineTextAlignment(.center)

                VStack(spacing: 8) {
                    if let qr = t.qrPayload {
                        QRCodeView(token: qr).frame(width: 200, height: 200)
                        Text(qr).font(.cfMono(13, weight: .semibold)).foregroundStyle(Theme.onQRSurface)
                    } else {
                        Image(systemName: "qrcode").font(.system(size: 54))
                            .foregroundStyle(Theme.onQRSurface.opacity(0.3))
                            .frame(width: 200, height: 160)
                        Text(locale.t("fv.qrInEmail"))
                            .font(.cfSans(11)).foregroundStyle(Theme.onQRSurface.opacity(0.6))
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity)
                .background(Theme.qrSurface, in: .rect(cornerRadius: 18))

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

                Button { openTicket = t } label: {
                    Text(locale.t("fv.viewTicket"))
                        .font(.cfSans(15, weight: .medium))
                        .foregroundStyle(Self.text)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Self.veil(0.18)))
                        .contentShape(.rect(cornerRadius: 12))
                }
                Button { dismiss() } label: {
                    Text(locale.t("fv.done"))
                        .font(.cfSans(16, weight: .semibold))
                        .foregroundStyle(Self.ctaLabel)
                        .frame(maxWidth: .infinity).frame(height: 54)
                        .background(Self.ctaFill, in: .rect(cornerRadius: 12))
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 28)
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private func go(_ p: FVProduct) async {
        errorText = nil
        Haptics.tap()
        if p.settle == .table || p.settle == .online {
            let formURL: URL?
            let unit: Double
            if p.settle == .table {
                guard let rate else { return }
                formURL = p.tableURL(rate: rate, pax: quantity); unit = rate.price
            } else {
                formURL = p.checkoutURL(quantity: quantity); unit = p.price
            }
            guard let formURL else { return }
            // Fill Fourvenues' details form in the hidden page — name, email,
            // confirm email, phone, the two required terms — and press Proceed
            // to payment there. Only the payment page itself is shown, in a
            // fresh web view with no script run in it, so Apple Pay works.
            guard let (name, email) = account, let phone else {
                errorText = locale.t("fv.cantComplete")
                return
            }
            let r = runner ?? FVFormRunner()
            runner = r
            working = true
            FVTrace.log("pay tapped (\(event.code))")
            do {
                var extras = FVAttendee(profile: auth.profile)
                extras.fullPayment = p.settle == .table && payInFull && rate?.offersFullPayment == true
                let pay = try await r.payURL(url: formURL, name: name, email: email, phone: phone, extras: extras)
                working = false
                // A table on deposit: remember what was paid now, so the ticket
                // shows the balance due at the venue.
                let paidNow = p.settle == .table && !extras.fullPayment ? rate?.depositAmount : nil
                checkout = CheckoutTarget(url: pay, product: p, heads: quantity, unitPrice: unit,
                                          paymentExpected: true, paidNow: paidNow)
            } catch FVFormRunner.Failure.rejected(let why) {
                working = false
                errorText = why.isEmpty ? locale.t("fv.rejected") : why
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
            FVTrace.log("no account name/email — showing the form")
            // Nothing to fill with — let the guest do it on Fourvenues' form.
            checkout = CheckoutTarget(url: url, product: p, heads: quantity, unitPrice: p.price, paymentExpected: false)
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
            FVTrace.log("sent, unconfirmed — no ticket issued")
            working = false
            errorText = locale.t("fv.unconfirmed")
            return
        } catch FVFormRunner.Failure.rejected(let why) {
            FVTrace.log("rejected by Fourvenues")
            working = false
            errorText = why.isEmpty ? locale.t("fv.rejected") : why
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
        guard let p = selected else { return }
        let url: URL? = p.settle == .table
            ? rate.flatMap { p.tableURL(rate: $0, pax: quantity) }
            : p.checkoutURL(quantity: quantity)
        guard let url else { return }
        let r = runner ?? FVFormRunner()
        runner = r
        r.preload(url)
    }

    @discardableResult
    private func issue(product p: FVProduct, heads: Int, unitPrice: Double, pdf: URL?, qr: String?) -> FVTicket {
        let t = FVTicket(
            eventCode: event.code, eventName: event.name, venue: event.venue, address: event.address,
            night: event.night, doors: event.doors, closes: event.closes, image: event.image,
            productName: p.settle == .table ? "\(p.name ?? "Table") · \(rate?.name ?? "")" : p.name,
            settle: p.settle.rawValue, unitPrice: unitPrice, heads: heads,
            qrPayload: qr, pdfURL: pdf?.absoluteString)
        FVTicketStore.shared.add(t)
        FVTicketStore.shared.focus = .local(t.id)
        // Onto the account, so it follows the user to another phone and the
        // ticket inbox can fill in the QR when Fourvenues' email lands.
        Task { await FVAccountSync.sync(auth.queries.supabaseService) }
        Haptics.success()
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
