import Foundation

// The guest's own promoter invites — GET /api/promoter-invites/mine.
//
// These lived in MyInvitesSection.swift, whose View was never presented by
// anything (BookingsView has its own `invitesSection`). The view is gone; the
// models were always live and belong here.

/// Wrapper for GET /api/promoter-invites/mine.
struct InvitesResponse: Decodable, Sendable {
    let invites: [InviteSummary]
}

struct InviteSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let fullName: String
    let plusOnes: Int
    let checkedInAt: String?
    let allocation: InviteAllocation

    // Convenience accessors for the merged Tickets list.
    var nightDate: String { allocation.night.nightDate }
    var eventTitle: String { allocation.night.title ?? venueName }
    var venueName: String { allocation.night.venueName }
    var inviteToken: String { allocation.inviteToken }
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
    /// OPTIONAL, and that is the whole point.
    ///
    /// A promoter night does not have to be at a registered club — it can carry
    /// `location_name` + `address` instead, which is how a one-off venue is
    /// booked. Two of the 753 nights in production are like that. This used to
    /// be non-optional, so `club: null` threw during decode, and because the
    /// loader wraps the call in `try?` the failure was swallowed whole: ONE
    /// clubless night blanked EVERY invite out of the Tickets tab, with no
    /// error anywhere. That is why a claimed invite "didn't show".
    let club: InviteAllocClub?
    let locationName: String?
    let address: String?
    let photoUrls: [String]?
    let lineup: [LineupCredit]?
    let hosts: [LineupCredit]?

    /// Club name first, then the promoter's own location, then a last resort —
    /// never blank, because this is the card's headline.
    var venueName: String { club?.name ?? locationName ?? "Barcelona" }
    var venueAddress: String? { club?.address ?? address }
    var neighborhood: String? { club?.neighborhood ?? locationName }
    var coverImageUrl: String? { club?.coverImageUrl ?? photoUrls?.first }

    var credits: [LineupCredit] { lineup ?? [] }
    var hostLine: String? {
        let names = (hosts ?? []).map(\.name)
        return names.isEmpty ? nil : names.joined(separator: " × ")
    }

    private func clock(_ s: String?) -> String? {
        guard let s, s.count >= 5 else { return nil }
        return String(s.prefix(5))
    }
    var doorsLabel: String? { clock(openTime) }
    var closesLabel: String? { clock(closeTime) }
}
struct InviteAllocClub: Decodable, Hashable, Sendable {
    let id: UUID
    let name: String
    let address: String?
    let neighborhood: String?
    let coverImageUrl: String?
}
