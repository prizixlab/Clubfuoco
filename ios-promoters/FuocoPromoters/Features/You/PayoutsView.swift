import SwiftUI

/// Getting paid for a ticketed event.
///
/// Everything real happens on Stripe: they run the identity checks, hold the
/// balance, and pay out to the promoter's bank on their own schedule. This
/// screen only ever does two things — say honestly where Stripe has got to, and
/// open the right hosted page.
///
/// The one thing it must not do is imply approval. Stripe returns a promoter
/// here whether they finished, abandoned, or were left pending review, and a
/// screen that says "you're set up" when Stripe hasn't cleared them sends
/// someone off to price an event whose first guest will fail at the card form.
struct PayoutsView: View {
    @State private var status: PromoterRepo.PayoutStatus?
    @State private var loading = true
    @State private var opening = false
    @State private var error: String?

    @Environment(\.openURL) private var openURL
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
        .task { await load() }
        // Onboarding happens in a browser, so the answer changes while this
        // screen is backgrounded — not while it's on top.
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
                        s.disabledReason.map { "Stripe says: \($0)" }
                        ?? "You can't price an event yet. This usually clears in a few minutes, sometimes a day.")
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

    /// Stripe's outstanding requirements, in Stripe's words.
    private func requirementsCard(_ s: PromoterRepo.PayoutStatus) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker("Stripe still needs", color: Theme.flame)
            ForEach(s.requirementsDue, id: \.self) { req in
                HStack(alignment: .top, spacing: 8) {
                    Text("•").foregroundStyle(Theme.flame)
                    Text(Self.humanise(req))
                        .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.flame.opacity(0.08)))
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

    private func actionButton(_ s: PromoterRepo.PayoutStatus) -> some View {
        Button {
            Task { await open() }
        } label: {
            HStack(spacing: 8) {
                if opening { ProgressView().tint(Theme.emberCream).scaleEffect(0.85) }
                Text(s.canCharge ? "Open Stripe dashboard"
                     : s.onboarded ? "Continue setup on Stripe"
                     : "Set up payouts")
                    .font(.cfSans(15, weight: .semibold))
            }
            .foregroundStyle(Theme.emberCream)
            .frame(maxWidth: .infinity).padding(.vertical, 14)
            .background(Capsule().fill(Theme.ember))
        }
        .disabled(opening)
    }

    private var disclaimer: some View {
        Text("Payments are handled by Stripe. Club Fuoco never sees your bank details or ID documents.")
            .font(.cfSans(11)).foregroundStyle(Theme.parchmentFaint)
    }

    /// Stripe's requirement keys are dotted paths. Left recognisable rather
    /// than rewritten — a promoter forwarding this to their accountant needs
    /// the term Stripe itself will use.
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

    private func load() async {
        loading = true
        defer { loading = false }
        do { status = try await repo.payoutStatus() }
        catch { self.error = error.localizedDescription }
    }

    private func open() async {
        opening = true
        error = nil
        defer { opening = false }
        do {
            let link = try await repo.payoutLink()
            if let url = URL(string: link.url) { openURL(url) }
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}
