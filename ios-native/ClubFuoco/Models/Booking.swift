import Foundation

/// Shape returned by GET /api/bookings (see src/app/api/bookings/route.ts):
/// `{ bookings, guest_signups, ticket_orders }`.
struct BookingsResponse: Decodable, Sendable {
    let bookings: [Booking]
    let guestSignups: [GuestSignup]
    let ticketOrders: [TicketOrder]
}

struct Booking: Decodable, Identifiable, Sendable {
    let id: UUID
    let bookingType: String
    let partySize: Int
    let bookingDate: String
    let arrivalWindow: String?
    let status: String
    let totalAmount: Double?
    let qrCodeToken: String?
    let createdAt: String?
    let clubs: EmbeddedOne<ClubSummary>?

    var club: ClubSummary? { clubs?.value }
}

struct ClubSummary: Decodable, Sendable {
    let id: UUID
    let name: String
    let coverImageUrl: String?
    let address: String?
    let neighborhood: String?
}

struct GuestSignup: Decodable, Identifiable, Sendable {
    let id: UUID
    let fullName: String?
    let partySize: Int?
    let status: String?
    let tier: String?
    let checkedIn: Bool?
    let createdAt: String?
    let guestLists: EmbeddedOne<GuestListSummary>?

    var guestList: GuestListSummary? { guestLists?.value }
}

struct GuestListSummary: Decodable, Sendable {
    let id: UUID
    let eventName: String?
    let eventDate: String?
    let cutoffTime: String?
    let freeEntryLabel: String?
}

struct TicketOrder: Decodable, Identifiable, Sendable {
    let id: UUID
    let eventName: String?
    let venueName: String?
    let venuePlaceId: String?
    let eventDate: String?
    let quantity: Int?
    let basePriceCents: Int?
    let markupCents: Int?
    let totalCents: Int?
    let status: String?
    let platform: String?
    let platformEventId: String?
    let createdAt: String?
}
