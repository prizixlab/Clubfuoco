import Foundation

/// Everything TicketCard draws, independent of where the night came from.
///
/// The Tickets tab holds two kinds of night that are the same thing to a guest:
/// a `Booking` they made themselves, and a promoter-guestlist `InviteSummary`
/// somebody sent them. They used to render completely differently — the booking
/// as the full ticket, the invite as a one-line strip with a sparkle icon — even
/// though both are "you are on a list at this venue on this night, here is your
/// QR". This is the shared shape, so the card is written once.
///
/// Deliberately plain values: the card formats them, nothing here reaches back
/// into a model or the network.
struct TicketCardData {
    var eventTitle: String?
    var venueName: String?
    var neighborhood: String?
    var address: String?
    var hostLine: String?
    var coverImageUrl: String?
    /// yyyy-MM-dd
    var date: String
    var doorsLabel: String?
    var closesLabel: String?
    var credits: [LineupCredit]
    var guests: Int
    /// nil or 0 renders as "Free".
    var totalAmount: Double?
    var status: String
    var checkedInAt: String?
    /// What the QR encodes. nil renders the placeholder glyph.
    var doorToken: String?
    /// The human-readable code printed beside the QR.
    var reference: String?
    /// Path on the API for the Wallet pass.
    var walletPath: String
    /// Localisation key for the TICKET cell — "General", "VIP", "Guestlist".
    var ticketTypeKey: String = "bookings.general"
    /// Owed at the venue, not paid in the app (a Fourvenues list priced at the
    /// door). The card shows it loudly — nobody should reach the door unaware.
    var payAtDoor: Double? = nil
}

extension TicketCardData {
    init(booking: Booking) {
        self.init(
            eventTitle: booking.event?.title,
            venueName: booking.club?.name,
            neighborhood: booking.club?.neighborhood,
            address: booking.club?.address,
            hostLine: booking.event?.hostLine,
            coverImageUrl: booking.club?.coverImageUrl,
            date: booking.bookingDate,
            doorsLabel: booking.event?.doorsLabel,
            closesLabel: booking.event?.closesLabel,
            credits: booking.event?.credits ?? [],
            guests: booking.partySize,
            totalAmount: booking.totalAmount,
            status: booking.status,
            checkedInAt: booking.checkedInAt,
            doorToken: booking.doorToken,
            reference: booking.qrCodeToken,
            walletPath: "/api/bookings/\(booking.id.uuidString.lowercased())/wallet",
            ticketTypeKey: booking.bookingType == "vip" ? "bookings.vip" : "bookings.general"
        )
    }

    init(invite: InviteSummary) {
        let night = invite.allocation.night
        let guestId = invite.id.uuidString.lowercased()
        self.init(
            eventTitle: night.title,
            venueName: night.venueName,
            neighborhood: night.neighborhood,
            address: night.venueAddress,
            hostLine: night.hostLine,
            coverImageUrl: night.coverImageUrl,
            date: night.nightDate,
            doorsLabel: night.doorsLabel,
            closesLabel: night.closesLabel,
            credits: night.credits,
            // The claimer plus whoever they brought — the door admits the party,
            // same as a booking's party_size.
            guests: invite.plusOnes + 1,
            // A guestlist spot is free at the door. A paid invite is taken
            // through checkout before the row exists, so there is nothing owed
            // on the card either way.
            totalAmount: nil,
            status: invite.checkedInAt != nil ? "used" : "confirmed",
            checkedInAt: invite.checkedInAt,
            // The payload the door scanner expects for a guest row — NOT the
            // booking scan_token format. See InviteClaimView's ticket QR.
            doorToken: "fuoco-invite:\(guestId)",
            reference: nil,
            walletPath: "/api/promoter-invites/guest/\(guestId)/wallet",
            ticketTypeKey: "bookings.guestlistTag"
        )
    }
}
