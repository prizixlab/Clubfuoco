import Foundation
import Supabase

// ── HypeList tickets on the account ──────────────────────────────────────────
//
// external_tickets (migration 20261001_ticket_inbox) is the account's record of
// every Fourvenues ticket: the app writes a row when a sign-up or payment
// completes, and the ticket-inbox webhook fills in the QR when Fourvenues'
// email lands (or files the ticket outright if the app never saw it). The
// device keeps FVTicketStore as a cache; sync() reconciles the two, so a
// ticket follows the account to a new phone and an emailed QR reaches the card.

struct ExternalTicketRow: Codable, Sendable {
    var id: UUID?
    var userId: UUID?
    var provider: String = "fourvenues"
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
    var unitPrice: Double
    var heads: Int
    var qrPayload: String?
    var pdfUrl: String?
    var successUrl: String?
    var source: String?
    var createdAt: String?
}

@MainActor
enum FVAccountSync {
    private struct Inserted: Decodable, Sendable { let id: UUID }
    /// Foreground, Tickets-tab load and a fresh sign-up can all fire a sync at
    /// once; overlapping runs each saw the ticket as unsynced and inserted it.
    private static var running = false

    /// Postgres timestamptz ("2026-10-01T14:51:33.387173+00:00").
    private static func date(_ s: String) -> Date? {
        let trimmed = s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return ISO8601DateFormatter().date(from: trimmed)
    }

    /// Two-way reconcile: push device tickets the account doesn't have yet,
    /// patch QR/PDF the device learned, pull what the account learned (an
    /// emailed QR, a ticket booked on another phone). Quietly does nothing when
    /// signed out or before the migration is applied.
    static func sync(_ supabase: SupabaseService) async {
        guard !running else { return }
        running = true
        defer { running = false }
        guard let session = await supabase.currentSession() else { return }
        let store = FVTicketStore.shared
        // Only ever reconcile the store against its own account. A mismatch
        // means the user changed mid-flight; the next sync gets it right.
        guard store.owner == session.user.id else {
            FVTrace.log("account sync skipped: store belongs to another account")
            return
        }
        let rows: [ExternalTicketRow]
        do {
            rows = try await supabase.client.from("external_tickets")
                .select("id,user_id,provider,event_code,event_name,venue,address,night,doors,closes,image,product_name,settle,unit_price,heads,qr_payload,pdf_url,success_url,source,created_at")
                .execute().value
        } catch {
            FVTrace.log("account sync skipped: \(error.localizedDescription)")
            return
        }
        // The fetch awaited the network — the user may have switched since.
        guard store.owner == session.user.id else { return }
        var byId: [UUID: ExternalTicketRow] = [:]
        for r in rows { if let id = r.id { byId[id] = r } }

        // 0. A linked ticket whose row is gone was deleted from the account —
        // drop the device copy too, or it would hold a claim on nothing.
        for t in store.tickets where t.serverId.map({ byId[$0] == nil }) ?? false {
            FVTrace.log("account sync: \(t.eventCode) no longer on the account — removing")
            store.remove(t)
        }

        // 1. Device → account.
        for t in store.tickets {
            if let sid = t.serverId, let row = byId[sid] {
                // Patch what only the device knows.
                var patch: [String: AnyJSON] = [:]
                if row.qrPayload == nil, let qr = t.qrPayload { patch["qr_payload"] = .string(qr) }
                if row.pdfUrl == nil, let pdf = t.pdfURL { patch["pdf_url"] = .string(pdf) }
                if row.successUrl == nil, let s = t.successURL { patch["success_url"] = .string(s) }
                if !patch.isEmpty {
                    _ = try? await supabase.client.from("external_tickets").update(patch).eq("id", value: sid.uuidString).execute()
                }
            } else if t.serverId == nil {
                // Already on the account under the same door code? Link, don't duplicate.
                if let qr = t.qrPayload, let match = rows.first(where: { $0.qrPayload == qr }), let mid = match.id {
                    store.update(t.id) { $0.serverId = mid }
                    continue
                }
                // No door code yet: claim an account row for the same night and
                // kind that no other device ticket has linked.
                let claimed = Set(store.tickets.compactMap(\.serverId))
                // A row the ticket inbox filed from Fourvenues' email may carry
                // a guessed settle (the email never says how money moves), so
                // it is claimed on event + night alone — insisting on the same
                // settle left two cards for one entry, one without a QR.
                if t.qrPayload == nil, let match = rows.first(where: {
                    $0.eventCode == t.eventCode && $0.night == t.night
                        && ($0.settle == t.settle || $0.source == "email")
                        && $0.id.map { !claimed.contains($0) } ?? false
                }), let mid = match.id {
                    store.update(t.id) { $0.serverId = mid }
                    // The device knows what was actually bought: correct the row.
                    if match.source == "email", match.settle != t.settle || match.unitPrice != t.unitPrice {
                        let fix: [String: AnyJSON] = [
                            "settle": .string(t.settle), "unit_price": .double(t.unitPrice),
                            "heads": .integer(t.heads),
                        ]
                        _ = try? await supabase.client.from("external_tickets").update(fix).eq("id", value: mid.uuidString).execute()
                    }
                    continue
                }
                let row = ExternalTicketRow(
                    userId: session.user.id, eventCode: t.eventCode, eventName: t.eventName, venue: t.venue,
                    address: t.address, night: t.night, doors: t.doors, closes: t.closes, image: t.image,
                    productName: t.productName, settle: t.settle, unitPrice: t.unitPrice, heads: t.heads,
                    qrPayload: t.qrPayload, pdfUrl: t.pdfURL, successUrl: t.successURL, source: "app")
                guard store.owner == session.user.id else { return }
                do {
                    let inserted: Inserted = try await supabase.client.from("external_tickets")
                        .insert(row).select("id").single().execute().value
                    store.update(t.id) { $0.serverId = inserted.id }
                    byId[inserted.id] = row
                } catch {
                    FVTrace.log("account sync insert failed (\(t.eventCode)): \(error.localizedDescription)")
                }
            }
        }

        // 2. Account → device.
        for r in rows {
            guard let sid = r.id else { continue }
            if let local = store.tickets.first(where: { $0.serverId == sid }) {
                if (local.qrPayload == nil && r.qrPayload != nil) || (local.pdfURL == nil && r.pdfUrl != nil) {
                    store.update(local.id) {
                        $0.qrPayload = $0.qrPayload ?? r.qrPayload
                        $0.pdfURL = $0.pdfURL ?? r.pdfUrl
                        $0.successURL = $0.successURL ?? r.successUrl
                    }
                }
            } else if !store.tickets.contains(where: { $0.qrPayload != nil && $0.qrPayload == r.qrPayload }) {
                store.add(FVTicket(
                    eventCode: r.eventCode, eventName: r.eventName, venue: r.venue, address: r.address,
                    night: r.night, doors: r.doors, closes: r.closes, image: r.image,
                    productName: r.productName, settle: r.settle, unitPrice: r.unitPrice, heads: r.heads,
                    qrPayload: r.qrPayload, pdfURL: r.pdfUrl, successURL: r.successUrl, serverId: sid,
                    createdAt: r.createdAt.flatMap(Self.date) ?? Date()),
                    quietly: true)
            }
        }
    }
}

/// The private address Fourvenues should mail tickets to, when the inbox is
/// live — the account email otherwise. Cached per user.
@MainActor
enum FVInbox {
    private struct Reply: Decodable, Sendable { let address: String; let active: Bool }

    static func email(api: APIClient, userId: String?, fallback: String) async -> String {
        let key = "fv.inbox.\(userId ?? "")"
        let checkedKey = key + ".checkedAt"
        // Re-asked at most daily: an address cached forever kept being handed
        // to Fourvenues after the inbox was switched off, so the mail bounced.
        let checked = UserDefaults.standard.object(forKey: checkedKey) as? Date
        if let cached = UserDefaults.standard.string(forKey: key),
           let checked, Date().timeIntervalSince(checked) < 24 * 3600 {
            return cached
        }
        guard let r: Reply = try? await api.get("/api/me/ticket-inbox") else {
            // Offline: the last known answer beats the account address.
            return UserDefaults.standard.string(forKey: key) ?? fallback
        }
        UserDefaults.standard.set(Date(), forKey: checkedKey)
        guard r.active else {
            FVTrace.log("ticket email: account address (inbox not active)")
            UserDefaults.standard.removeObject(forKey: key)
            return fallback
        }
        FVTrace.log("ticket email: private inbox")
        UserDefaults.standard.set(r.address, forKey: key)
        return r.address
    }
}
