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
    var eventTitle: String { allocation.night.title ?? allocation.night.club.name }
    var venueName: String { allocation.night.club.name }
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
    let club: InviteAllocClub
}
struct InviteAllocClub: Decodable, Hashable, Sendable {
    let id: UUID
    let name: String
    let address: String?
}
