import SwiftUI

/// Getting paid for a ticketed event — now fully in-app.
///
/// Stripe still does the real work: identity checks, holding the balance, and
/// paying out to the promoter's bank on its own schedule. What changed is that
/// the promoter never leaves Fuoco to deal with any of it. Onboarding is the
/// embedded StripeConnect component (`AccountOnboardingSheet`), presented as a
/// sheet; the money — balance, what's clearing, lifetime paid, recent payouts —
/// is drawn natively from `/api/promoter/payouts/summary`.
///
/// The one thing it must not do is imply approval. Stripe returns a promoter
/// from onboarding whether they finished, abandoned, or were left pending, and
/// a screen that says "you're set up" when Stripe hasn't cleared them sends
/// someone off to price an event whose first guest will fail at the card form.
struct PayoutsView: View {
    @State private var status: PromoterRepo.PayoutStatus?
    @State private var summary: PromoterRepo.PayoutSummary?
    @State private var loading = true
    @State private var error: String?

    @StateObject private var onboarding = PayoutOnboardingModel()
    private let repo = PromoterRepo()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header

                if loading && status == nil {
                    ProgressView().tint(Theme.parchment).frame(maxWidth: .infinity)
                } else if let s = status {
                    stateCard(s)
                    if !s.requirementsDue.isEmpty { requirementsCard(s) }

                    // The money — only once Stripe can actually pay them.
                    if s.canCharge, let sum = summary {
                        balanceCard(sum)
                        if !sum.payouts.isEmpty { payoutsCard(sum) }
                    }

                    feeCard(s)
                    actionButton(s)
                }

                if let error {
                    Text(error)
                        .font(.cfSans(13)).foregroundStyle(Theme.wine)
                }

                disclaimer
                Spacer(minLength: 24)
            }
            .padding(22)
        }
        .background(Theme.night.ignoresSafeArea())
        .navigationTitle("Getting paid")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Stripe's onboarding exits back into the app; reload when it does.
            onboarding.onExit = { Task { await load() } }
            await load()
        }
        // Stripe's answer can also change while the app is backgrounded.
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await load() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker("Payouts", color: Theme.gold)
            Text("Charge for entry")
                .font(.cfSerif(30)).foregroundStyle(Theme.parchment)
            Text("Guests pay in the app. The money goes to your own Stripe account and Stripe pays it into your bank — it never sits with Club Fuoco.")
                .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
        }
    }

    private func stateCard(_ s: PromoterRepo.PayoutStatus) -> some View {
        let (icon, tint, title, detail): (String, Color, String, String) = {
            if s.canCharge && s.payoutsEnabled {
                return ("checkmark.seal.fill", Theme.gold, "Ready",
                        "You can price events and take payments.")
            }
            if s.canCharge {
                return ("checkmark.seal.fill", Theme.gold, "Taking payments",
                        "You can charge for entry. Stripe is still finishing your bank payouts — the money is safe in your Stripe balance until it does.")
            }
            if s.onboarded {
                return ("clock.fill", Theme.flame, "Stripe is reviewing you",
                        Self.explain(s.disabledReason))
            }
            return ("creditcard", Theme.parchmentDim, "Not set up",
                    "Set up payouts to charge for entry. Free guestlists work without this.")
        }()

        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 18)).foregroundStyle(tint).frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.cfSans(15, weight: .semibold)).foregroundStyle(Theme.parchment)
                Text(detail).font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.hairline))
    }

    /// What Stripe still wants, in categories rather than field paths.
    ///
    /// This used to list `currently_due` verbatim — fifteen rows of
    /// "representative · address · city" on a fresh account. The intent was not
    /// to paraphrase away detail a stuck promoter needs, but the result read
    /// like a schema dump and, worse, arrived BEFORE the button that fixes it.
    ///
    /// Embedded onboarding collects every one of these fields itself, properly
    /// labelled and in order. So the card's job is no longer to enumerate — it
    /// is to set expectations for what the next tap will ask for. The raw list
    /// stays one disclosure away for the rare account that is genuinely stuck.
    private func requirementsCard(_ s: PromoterRepo.PayoutStatus) -> some View {
        let groups = Self.summarise(s.requirementsDue)
        return VStack(alignment: .leading, spacing: 10) {
            Kicker("Stripe will ask for", color: Theme.flame)

            ForEach(groups, id: \.self) { g in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "circle.fill")
                        .font(.system(size: 4)).foregroundStyle(Theme.flame)
                        .padding(.top, 6)
                    Text(g).font(.cfSans(13)).foregroundStyle(Theme.parchment)
                }
            }

            DisclosureGroup {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(s.requirementsDue, id: \.self) { req in
                        Text(req)
                            .font(.cfMono(10)).foregroundStyle(Theme.parchmentFaint)
                            .textSelection(.enabled)
                    }
                }
                .padding(.top, 6)
            } label: {
                Text("Stripe's exact field list")
                    .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
            }
            .tint(Theme.parchmentDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.flame.opacity(0.08)))
    }

    /// Collapse Stripe's dotted field paths into the handful of things a person
    /// actually has to go and find. Order is the order they'll be asked.
    static func summarise(_ due: [String]) -> [String] {
        var out: [String] = []
        func add(_ s: String) { if !out.contains(s) { out.append(s) } }

        for key in due {
            switch true {
            case key.contains("business_type"), key.contains("business_profile"):
                add("What kind of business you are")
            case key.contains("dob"), key.contains("first_name"), key.contains("last_name"),
                 key.contains("nationality"), key.contains("id_number"):
                add("Your name, date of birth and nationality")
            case key.contains("address"):
                add("Your address")
            case key.contains("email"), key.contains("phone"):
                add("Contact details")
            case key.contains("verification.document"):
                add("A photo of your ID")
            case key.contains("external_account"):
                add("A bank account to be paid into")
            case key.contains("tos_acceptance"):
                add("Accepting Stripe's terms")
            default:
                break
            }
        }
        // Anything unrecognised is still worth flagging, without naming it —
        // the disclosure below has the specifics.
        if out.isEmpty && !due.isEmpty { add("A few more details") }
        return out
    }

    /// Balance, drawn natively from the connected account. "Available" is what
    /// Stripe can pay out next; "On the way" is still clearing from recent
    /// sales; "Paid out" is the lifetime total that has reached the bank.
    private func balanceCard(_ sum: PromoterRepo.PayoutSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Kicker("Your money", color: Theme.gold)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Self.money(sum.availableCents, sum.currency))
                    .font(.cfSerif(34)).foregroundStyle(Theme.parchment)
                Text("available")
                    .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
            }

            HStack(spacing: 24) {
                amountStat("On the way", sum.pendingCents, sum.currency, Theme.flame)
                amountStat("Paid out", sum.paidOutCents, sum.currency, Theme.parchmentDim)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 18).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.hairline))
    }

    private func amountStat(_ label: String, _ cents: Int, _ currency: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.cfSans(11)).foregroundStyle(Theme.parchmentFaint)
            Text(Self.money(cents, currency)).font(.cfMono(15)).foregroundStyle(tint)
        }
    }

    /// Recent payouts to the bank, newest first, each with Stripe's status.
    private func payoutsCard(_ sum: PromoterRepo.PayoutSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker("Recent payouts", color: Theme.gold)
            ForEach(sum.payouts) { p in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.money(p.amountCents, p.currency))
                            .font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                        Text(Self.payoutDateLine(p))
                            .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
                    }
                    Spacer(minLength: 0)
                    statusPill(p.status)
                }
                if p.id != sum.payouts.last?.id {
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.hairline))
    }

    private func statusPill(_ status: String) -> some View {
        let (label, tint): (String, Color) = {
            switch status {
            case "paid":       return ("Paid", Theme.gold)
            case "in_transit": return ("On the way", Theme.flame)
            case "pending":    return ("Pending", Theme.flame)
            case "failed":     return ("Failed", Theme.wine)
            case "canceled":   return ("Canceled", Theme.wine)
            default:           return (status.capitalized, Theme.parchmentDim)
            }
        }()
        return Text(label)
            .font(.cfSans(11, weight: .semibold)).foregroundStyle(tint)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(Capsule().fill(tint.opacity(0.12)))
    }

    /// What we take. Two numbers when the deals differ, one when they don't —
    /// showing "12% / 12%" would invent a distinction the promoter doesn't have.
    private func feeCard(_ s: PromoterRepo.PayoutStatus) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "percent").font(.system(size: 13)).foregroundStyle(Theme.gold)
                Text(s.feesMatch ? "Club Fuoco takes \(s.feePercent)" : "What Club Fuoco takes")
                    .font(.cfSans(14, weight: .medium)).foregroundStyle(Theme.parchment)
                Spacer(minLength: 0)
            }

            if !s.feesMatch, let pub = s.publicFeePercent {
                VStack(spacing: 6) {
                    rateRow("Private events", s.feePercent)
                    rateRow("Public offers", pub)
                }
            }

            Text("Taken automatically from each sale. The rest is yours.")
                .font(.cfSans(11)).foregroundStyle(Theme.parchmentDim)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.nightLift))
    }

    private func rateRow(_ label: String, _ pct: String) -> some View {
        HStack {
            Text(label).font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
            Spacer()
            Text(pct).font(.cfMono(14)).foregroundStyle(Theme.gold)
        }
    }

    /// Onboarding opens the embedded sheet in-app. Once cleared, there is no
    /// button — the money is shown right here, so there is nothing to "open".
    @ViewBuilder
    private func actionButton(_ s: PromoterRepo.PayoutStatus) -> some View {
        if !s.canCharge {
            Button {
                onboarding.present()
            } label: {
                Text(s.onboarded ? "Continue setup" : "Set up payouts")
                    .font(.cfSans(15, weight: .semibold))
                    .foregroundStyle(Theme.emberCream)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Capsule().fill(Theme.ember))
            }
        }
    }

    private var disclaimer: some View {
        Text("Payments are handled by Stripe. Club Fuoco never sees your bank details or ID documents.")
            .font(.cfSans(11)).foregroundStyle(Theme.parchmentFaint)
    }

    /// Stripe's requirement keys are dotted paths. Left recognisable rather
    /// than rewritten — a promoter forwarding this to their accountant needs
    /// the term Stripe itself will use.
    /// Stripe's `disabled_reason` is an enum — "requirements.past_due",
    /// "under_review". Printing it as `Stripe says: …` presented a machine
    /// constant as if it were a message to the promoter.
    static func explain(_ reason: String?) -> String {
        switch reason {
        case .some(let r) where r.contains("past_due"):
            return "Stripe needs a few details before you can take payments. It takes about five minutes."
        case .some(let r) where r.contains("pending_verification"), .some(let r) where r.contains("under_review"):
            return "Stripe is checking what you sent. This usually clears in a few minutes, sometimes a day."
        case .some(let r) where r.contains("rejected"):
            return "Stripe couldn't approve this account. Their support can tell you why."
        case .some(let r) where r.contains("listed"):
            return "Stripe needs to review this account before it can take payments."
        default:
            return "You can't price an event yet. Finish setup and this clears on its own."
        }
    }

    static func humanise(_ key: String) -> String {
        let map: [String: String] = [
            "individual.verification.document": "A photo ID (individual verification document)",
            "individual.id_number": "Your ID number",
            "external_account": "A bank account to pay out to",
            "business_profile.url": "A website or social profile",
            "individual.address.line1": "Your address",
            "tos_acceptance.date": "Accept Stripe's terms",
        ]
        if let friendly = map[key] { return friendly }
        return key.replacingOccurrences(of: "_", with: " ")
                  .replacingOccurrences(of: ".", with: " · ")
    }

    /// Cents → a currency string in the account's own currency.
    static func money(_ cents: Int, _ currency: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency.uppercased()
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: Double(cents) / 100)) ?? "\(Double(cents) / 100)"
    }

    /// "Arrives 12 Aug" while clearing; "Paid 12 Aug" once it has landed.
    static func payoutDateLine(_ p: PromoterRepo.Payout) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(p.arrivalDate))
        let df = DateFormatter()
        df.dateFormat = "d MMM"
        let verb = p.status == "paid" ? "Paid" : "Arrives"
        return "\(verb) \(df.string(from: date))"
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            status = try await repo.payoutStatus()
            // Money only matters once Stripe can pay them; skip the call
            // otherwise so a not-yet-onboarded promoter sees no spurious error.
            if status?.canCharge == true {
                summary = try await repo.payoutSummary()
            } else {
                summary = nil
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
