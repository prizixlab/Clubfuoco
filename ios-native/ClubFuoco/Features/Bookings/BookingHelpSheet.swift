import SwiftUI

/// Guest-facing help for one reservation.
///
/// Two jobs, in this order: give an answer the guest can act on *now* (most
/// door problems are solved in the queue, not by a reply hours later), and only
/// then file a report to support carrying the booking's context so nobody has
/// to repeat themselves.
struct BookingHelpSheet: View {
    let booking: Booking

    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @Environment(\.dismiss) private var dismiss

    @State private var topic: HelpTopic?
    @State private var note = ""
    @State private var sending = false
    @State private var sent = false
    @State private var failed = false

    enum HelpTopic: String, CaseIterable, Identifiable {
        case refused, qr, details, charge, queue, other
        var id: String { rawValue }

        var titleKey: String {
            switch self {
            case .refused: "help.refused"; case .qr: "help.qr"
            case .details: "help.details"; case .charge: "help.charge"
            case .queue:   "help.queue";   case .other: "help.other"
            }
        }
        var bodyKey: String {
            switch self {
            case .refused: "help.refusedBody"; case .qr: "help.qrBody"
            case .details: "help.detailsBody"; case .charge: "help.chargeBody"
            case .queue:   "help.queueBody";   case .other: "help.otherBody"
            }
        }
        var icon: String {
            switch self {
            case .refused: "hand.raised.slash"; case .qr: "qrcode.viewfinder"
            case .details: "pencil.line";       case .charge: "creditcard.trianglebadge.exclamationmark"
            case .queue:   "clock.badge.exclamationmark"; case .other: "ellipsis.bubble"
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if sent { sentState } else { picker }
                }
                .padding(20)
            }
            .background(Theme.cream.ignoresSafeArea())
            .navigationTitle(locale.t("help.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(locale.t("common.close")) { dismiss() }
                }
            }
        }
    }

    // MARK: Picker

    private var picker: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(locale.t("help.subtitle"))
                .font(.cfSans(13)).foregroundStyle(Theme.stone)

            // The fastest fix for a door problem is the reference itself, so it
            // sits above the report form rather than behind it.
            reference

            VStack(spacing: 0) {
                ForEach(HelpTopic.allCases) { t in
                    Button { withAnimation { topic = t } } label: { row(t) }
                    if t != HelpTopic.allCases.last {
                        Divider().overlay(Theme.hairline).padding(.leading, 52)
                    }
                }
            }
            .background(Theme.surface, in: .rect(cornerRadius: 14))
            .shadow(color: Theme.ink.opacity(0.05), radius: 8, y: 2)

            if topic != nil { composer }
        }
    }

    private func row(_ t: HelpTopic) -> some View {
        HStack(spacing: 14) {
            Image(systemName: t.icon)
                .font(.system(size: 15))
                .foregroundStyle(topic == t ? Theme.ember : Theme.stone)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(locale.t(t.titleKey))
                    .font(.cfSans(14, weight: .medium)).foregroundStyle(Theme.ink)
                Text(locale.t(t.bodyKey))
                    .font(.cfSans(11)).foregroundStyle(Theme.stone)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            Image(systemName: topic == t ? "checkmark.circle.fill" : "chevron.right")
                .font(.system(size: topic == t ? 16 : 11, weight: .semibold))
                .foregroundStyle(topic == t ? Theme.ember : Theme.sand)
        }
        .padding(14)
        .contentShape(Rectangle())
    }

    private var reference: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(locale.t("help.urgent").uppercased())
                .font(.cfMono(9)).kerning(0.8).foregroundStyle(Theme.ember)
            Text(locale.t("help.urgentBody"))
                .font(.cfSans(12)).foregroundStyle(Theme.stone)
            if let ref = booking.qrCodeToken {
                HStack {
                    Text(locale.t("help.reference").uppercased())
                        .font(.cfMono(9)).kerning(0.8).foregroundStyle(Theme.ember.opacity(0.75))
                    Spacer()
                    Text(ref).font(.cfMono(13)).foregroundStyle(Theme.ink)
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.ember.opacity(0.09), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.ember.opacity(0.20)))
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(locale.t("help.describe"))
                .font(.cfSans(12)).foregroundStyle(Theme.stone)
            TextEditor(text: $note)
                .font(.cfSans(14))
                .frame(minHeight: 90)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Theme.surface, in: .rect(cornerRadius: 12))
                .shadow(color: Theme.ink.opacity(0.05), radius: 8, y: 2)

            if failed {
                Text(locale.t("help.failed"))
                    .font(.cfSans(12)).foregroundStyle(Theme.wine)
            }

            Button { Task { await send() } } label: {
                Text(locale.t(sending ? "help.sending" : "help.send"))
                    .font(.cfSans(15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(Theme.wine, in: .rect(cornerRadius: 12))
                    .opacity(sending ? 0.6 : 1)
            }
            .disabled(sending)
        }
    }

    private var sentState: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 40)).foregroundStyle(Theme.ember)
            Text(locale.t("help.sentTitle"))
                .font(.cfSerif(26)).foregroundStyle(Theme.ink)
            Text(locale.t("help.sentBody"))
                .font(.cfSans(13)).foregroundStyle(Theme.stone)
                .multilineTextAlignment(.center)
            Button(locale.t("common.close")) { dismiss() }
                .font(.cfSans(15, weight: .semibold))
                .foregroundStyle(Theme.stone)
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: Send

    private func send() async {
        guard let topic else { return }
        sending = true; failed = false
        defer { sending = false }
        struct Body: Encodable { let topic: String; let message: String; let bookingId: String }
        struct Resp: Decodable, Sendable { let id: String }
        do {
            let _: Resp = try await api.post("/api/support",
                                             body: Body(topic: topic.rawValue,
                                                        message: note,
                                                        bookingId: booking.id.uuidString))
            Haptics.success()
            withAnimation { sent = true }
        } catch {
            Haptics.error()
            failed = true
        }
    }
}
