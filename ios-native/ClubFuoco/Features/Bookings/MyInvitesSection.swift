import SwiftUI

/// Section on the Bookings/Tickets tab listing the user's claimed promoter
/// invites. Tapping a card reopens InviteClaimView in ticket mode (QR +
/// Wallet button) so it can serve as the door pass.
struct MyInvitesSection: View {
    @Environment(\.api) private var api
    @State private var loading = true
    @State private var invites: [InviteSummary] = []
    @State private var openInvite: InviteSummary?

    var body: some View {
        Group {
            if loading {
                EmptyView()
            } else if invites.isEmpty {
                EmptyView()
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Kicker("Guestlists", color: Theme.gold)
                        .padding(.horizontal, 20)
                    VStack(spacing: 12) {
                        ForEach(invites) { inv in
                            Button { openInvite = inv } label: {
                                inviteCard(inv)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
        .task { await load() }
        .sheet(item: $openInvite) { inv in
            InviteClaimView(
                token: inv.allocation.inviteToken,
                preclaimedGuestId: inv.id.uuidString.lowercased(),
                preclaimedName: inv.fullName
            )
            .presentationDetents([.large])
        }
    }

    private func load() async {
        loading = true
        struct Resp: Decodable, Sendable { let invites: [InviteSummary] }
        if let resp: Resp = try? await api.get("/api/promoter-invites/mine") {
            invites = resp.invites
        }
        loading = false
    }

    private func inviteCard(_ inv: InviteSummary) -> some View {
        let club = inv.allocation.night.club.name
        let title = inv.allocation.night.title ?? club
        let date = Self.formatDate(inv.allocation.night.nightDate)
        return HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Theme.gold.opacity(0.15))
                    .frame(width: 56, height: 56)
                Image(systemName: "ticket")
                    .font(.system(size: 20))
                    .foregroundStyle(Theme.gold)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.cfSerif(20))
                    .foregroundStyle(Theme.ink)
                Text("\(club) · \(date)")
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.stone)
                HStack(spacing: 8) {
                    Kicker(inv.checkedInAt != nil ? "Checked in" : "Confirmed",
                           color: inv.checkedInAt != nil ? Theme.gold : Theme.stone,
                           size: 9)
                    if inv.plusOnes > 0 {
                        Text("+\(inv.plusOnes)")
                            .font(.cfMono(10))
                            .foregroundStyle(Theme.fadedSand)
                    }
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13))
                .foregroundStyle(Theme.fadedSand)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.5)))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
    }

    private static func formatDate(_ ymd: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        let out = DateFormatter(); out.dateFormat = "EEE d MMM"
        return out.string(from: d)
    }
}

struct InviteSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let fullName: String
    let plusOnes: Int
    let checkedInAt: String?
    let allocation: InviteAllocation
}
struct InviteAllocation: Decodable, Hashable, Sendable {
    let id: UUID
    let inviteToken: String
    let spots: Int
    let night: InviteAllocNight
}
struct InviteAllocNight: Decodable, Hashable, Sendable {
    let id: UUID
    let title: String?
    let nightDate: String
    let openTime: String?
    let closeTime: String?
    let club: InviteAllocClub
}
struct InviteAllocClub: Decodable, Hashable, Sendable {
    let id: UUID
    let name: String
    let address: String?
}
