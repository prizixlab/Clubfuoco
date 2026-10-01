import Foundation
import Observation
import PDFKit
import Vision

/// A Fourvenues ticket the guest got through us, with the QR the door scans.
///
/// The QR payload is a plain code (e.g. "LNKO1S1G1" — the event code plus a
/// sequence), printed under the QR on their PDF. We read it off that PDF, so
/// the card in the Tickets tab scans exactly like Fourvenues' own.
struct FVTicket: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var eventCode: String
    var eventName: String?
    var venue: String?
    var address: String?
    var night: String
    var doors: String?
    var closes: String?
    var image: String?
    var productName: String?
    var settle: String
    /// Unit price; what is owed at the door for `.door`, what was paid for `.online`.
    var unitPrice: Double
    var heads: Int
    var qrPayload: String?
    /// Fourvenues' own PDF. Anyone holding this URL can open the ticket, so it
    /// is treated like a password: stored on device, never logged.
    var pdfURL: String?
    /// Fourvenues' own page for this ticket. Behind a bot check, so the guest
    /// opens it themselves ("Show my ticket") when the QR isn't known yet.
    var successURL: String?
    /// external_tickets.id once the ticket is on the account.
    var serverId: UUID?
    var createdAt: Date = Date()

    var owedAtDoor: Double? { settle == Settle.door.rawValue ? unitPrice * Double(heads) : nil }
    var paidOnline: Double? { settle == Settle.online.rawValue ? unitPrice * Double(heads) : nil }
}

enum FVFocus: Equatable {
    case local(UUID)    // FVTicket.id
    case server(UUID)   // external_tickets.id, from a push
}

/// PROTOTYPE persistence: a JSON file on the device. The real version writes to
/// an owner-only `external_tickets` table so the ticket follows the account.
@MainActor @Observable
final class FVTicketStore {
    static let shared = FVTicketStore()

    private(set) var tickets: [FVTicket] = []

    /// The ticket the Tickets page scrolls to and lights up the next time it
    /// is on screen — set the moment a ticket is issued (so it is plainly
    /// there, no "Done" needed) and when its "ticket ready" push is tapped.
    var focus: FVFocus?
    /// Raised by a tapped ticket push; the tab bar switches to Tickets.
    var wantsTicketsTab = false

    private let file: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("fourvenues-tickets.json")
    }()

    private init() {
        if let data = try? Data(contentsOf: file),
           let saved = try? JSONDecoder().decode([FVTicket].self, from: data) {
            tickets = saved
        }
    }

    func add(_ t: FVTicket, quietly: Bool = false) {
        tickets.insert(t, at: 0)
        save()
    }

    func update(_ id: UUID, _ change: (inout FVTicket) -> Void) {
        guard let i = tickets.firstIndex(where: { $0.id == id }) else { return }
        change(&tickets[i])
        save()
    }

    func remove(_ t: FVTicket) {
        tickets.removeAll { $0.id == t.id }
        save()
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(tickets) else { return }
        try? data.write(to: file, options: [.atomic, .completeFileProtection])
    }
}

/// Reads the door QR out of a Fourvenues ticket PDF.
enum FVTicketReader {
    struct Result { let qrPayload: String?; let text: String }

    static func read(pdfURL: URL) async throws -> Result {
        let (data, response) = try await URLSession.shared.data(from: pdfURL)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let doc = PDFDocument(data: data), let page = doc.page(at: 0)
        else { throw URLError(.cannotDecodeContentData) }

        let thumb = page.thumbnail(of: CGSize(width: 1400, height: 2000), for: .mediaBox)
        var payload: String?
        if let cg = thumb.cgImage {
            let request = VNDetectBarcodesRequest()
            request.symbologies = [.qr]
            try VNImageRequestHandler(cgImage: cg).perform([request])
            payload = request.results?.first?.payloadStringValue
        }
        return Result(qrPayload: payload, text: page.string ?? "")
    }
}
