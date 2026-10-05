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
    /// A table paid by deposit: what was paid now. The rest is owed at the venue.
    var paidNow: Double?

    var owedAtDoor: Double? {
        if settle == Settle.door.rawValue { return unitPrice * Double(heads) }
        // A table's price is for the table, not per head.
        if settle == Settle.table.rawValue, let paidNow, unitPrice - paidNow > 0.009 { return unitPrice - paidNow }
        return nil
    }
    var paidOnline: Double? { settle == Settle.online.rawValue ? unitPrice * Double(heads) : nil }
}

enum FVFocus: Equatable {
    case local(UUID)    // FVTicket.id
    case server(UUID)   // external_tickets.id, from a push
}

/// The device's cache of the signed-in account's tickets; `external_tickets`
/// is the account's record (FVAccountSync reconciles the two).
///
/// ONE FILE PER ACCOUNT. It used to be one file for the whole phone, never
/// cleared on sign-out — so when someone else signed in on the same phone,
/// sync removed the first person's synced tickets and pushed their unsynced
/// ones, door QR and PDF link included, into the second person's account.
/// AuthStore calls use(owner:) whenever the signed-in user changes; signed out,
/// the store is empty and writes nothing.
@MainActor @Observable
final class FVTicketStore {
    static let shared = FVTicketStore()

    private(set) var tickets: [FVTicket] = []
    /// Whose tickets these are (auth user id). Nil = signed out.
    private(set) var owner: UUID?

    /// The ticket the Tickets page scrolls to and lights up the next time it
    /// is on screen — set the moment a ticket is issued (so it is plainly
    /// there, no "Done" needed) and when its "ticket ready" push is tapped.
    var focus: FVFocus?
    /// Raised by a tapped ticket push; the tab bar switches to Tickets.
    var wantsTicketsTab = false

    private static let dir: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    /// The pre-per-account file. Adopted once by the first account to sign in.
    private static let legacyFile = dir.appendingPathComponent("fourvenues-tickets.json")
    private static func file(for owner: UUID) -> URL {
        dir.appendingPathComponent("fourvenues-tickets-\(owner.uuidString.lowercased()).json")
    }

    /// UserDefaults key for the phone typed for paid checkouts — per account
    /// too, or the next person's checkout would be pre-filled with it.
    nonisolated static var phoneKey: String {
        "fv.phone." + (UserDefaults.standard.string(forKey: "fv.owner") ?? "signed-out")
    }

    private init() {}

    /// Switch to `owner`'s tickets (nil = signed out). Cheap to call repeatedly.
    func use(owner new: UUID?) {
        guard new != owner else { return }
        owner = new
        focus = nil
        UserDefaults.standard.set(new?.uuidString.lowercased(), forKey: "fv.owner")
        guard let new else { tickets = []; return }
        let file = Self.file(for: new)
        let fm = FileManager.default
        // The tickets saved before this was per account belong to whoever was
        // using the phone then — almost always the person signing in now.
        if !fm.fileExists(atPath: file.path), fm.fileExists(atPath: Self.legacyFile.path) {
            try? fm.moveItem(at: Self.legacyFile, to: file)
            if let phone = UserDefaults.standard.string(forKey: "fv.phone") {
                UserDefaults.standard.set(phone, forKey: Self.phoneKey)
            }
            UserDefaults.standard.removeObject(forKey: "fv.phone")
        }
        if let data = try? Data(contentsOf: file),
           let saved = try? JSONDecoder().decode([FVTicket].self, from: data) {
            tickets = saved
        } else {
            tickets = []
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
        guard let owner, let data = try? JSONEncoder().encode(tickets) else { return }
        let file = Self.file(for: owner)
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
