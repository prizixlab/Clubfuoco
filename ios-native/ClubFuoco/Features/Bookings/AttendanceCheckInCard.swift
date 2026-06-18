import SwiftUI
import CoreLocation

/// "I'm here" + post-entry prompt — the user-facing surface of the attendance
/// verification system (see `supabase/migrations/booking_attendance.sql`).
///
/// Three states, driven by current time relative to the booking's arrival
/// window and the rolled-up `attendance_status` on the booking row:
///   1. Pre-window  → nothing rendered.
///   2. In window   → "I'm here" button. Tap fires a one-shot location read
///                    and posts a `user_checkin` signal.
///   3. Post-window → "Did you get in?" prompt with three answers.
///
/// Once a positive signal has been recorded for this booking, the card
/// collapses to a quiet confirmation banner.
struct AttendanceCheckInCard: View {
    let booking: Booking
    /// Called after a successful signal post — the parent should refresh the
    /// booking so the new `attendance_status` lands on screen.
    var onSignalPosted: () -> Void = {}

    @Environment(\.api) private var api
    @State private var posting = false
    @State private var feedback: String?
    @State private var showIssueSheet = false

    var body: some View {
        if shouldShow {
            VStack(alignment: .leading, spacing: 12) {
                Text(headerKicker)
                    .font(.cfMono(9))
                    .kerning(1.6)
                    .foregroundStyle(Theme.wine.opacity(0.7))
                Text(headerTitle)
                    .font(.cfSerif(20))
                    .foregroundStyle(Theme.ink)
                Text(subtitle)
                    .font(.cfSans(12.5))
                    .foregroundStyle(Theme.stone)
                    .fixedSize(horizontal: false, vertical: true)

                content

                if let feedback {
                    Text(feedback)
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.wine)
                        .padding(.top, 4)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: .rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.wine.opacity(state == .alreadyConfirmed ? 0.5 : 0.2)))
            .shadow(color: Color(hex: 0x221E1A).opacity(0.05), radius: 8, y: 2)
            .confirmationDialog("What happened at the door?",
                                isPresented: $showIssueSheet,
                                titleVisibility: .visible) {
                ForEach(IssueReason.allCases, id: \.self) { reason in
                    Button(reason.label) { Task { await post(kind: "post_entry_issue", reason: reason) } }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    // ── State machine ─────────────────────────────────────────────────────────

    enum Phase { case preWindow, checkInOpen, postWindow, alreadyConfirmed, hidden }

    private var state: Phase {
        if booking.status == "cancelled" { return .hidden }
        switch booking.attendanceStatus {
        case "verified_attended", "likely_attended", "user_claimed_attended", "no_show", "disputed":
            return .alreadyConfirmed
        default: break
        }
        let now = Date()
        let (earliest, base, postCutoff) = bookingTimes
        if now < earliest { return .preWindow }
        if now <= base.addingTimeInterval(2 * 3600) { return .checkInOpen }
        if now <= postCutoff { return .postWindow }
        return .hidden
    }

    private var shouldShow: Bool { state != .hidden && state != .preWindow }

    @ViewBuilder private var content: some View {
        switch state {
        case .checkInOpen:
            checkInButton
        case .postWindow:
            postEntryButtons
        case .alreadyConfirmed:
            EmptyView()
        default:
            EmptyView()
        }
    }

    private var checkInButton: some View {
        Button { Task { await post(kind: "user_checkin") } } label: {
            HStack(spacing: 8) {
                if posting {
                    ProgressView().tint(Theme.cream).scaleEffect(0.8)
                } else {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(posting ? "Checking you in…" : "I'm here")
                    .font(.cfSans(14, weight: .semibold))
            }
            .foregroundStyle(Theme.cream)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Theme.wine, in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(posting)
    }

    private var postEntryButtons: some View {
        HStack(spacing: 8) {
            entryButton(label: "Got in",     systemImage: "checkmark") {
                Task { await post(kind: "post_entry_got_in") }
            }
            entryButton(label: "Had an issue", systemImage: "exclamationmark.triangle") {
                Haptics.tap(); showIssueSheet = true
            }
        }
    }

    private func entryButton(label: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage).font(.system(size: 12, weight: .semibold))
                Text(label).font(.cfSans(13, weight: .medium))
            }
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(Color.white, in: .rect(cornerRadius: 11))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(Theme.hairline))
        }
        .buttonStyle(.plain)
        .disabled(posting)
    }

    // ── Copy ──────────────────────────────────────────────────────────────────

    private var headerKicker: String {
        switch state {
        case .checkInOpen:       "ATTENDANCE"
        case .postWindow:        "AFTER THE NIGHT"
        case .alreadyConfirmed:  "ATTENDANCE"
        default:                 ""
        }
    }
    private var headerTitle: String {
        switch state {
        case .checkInOpen:       "You're nearby?"
        case .postWindow:        "Did you get in?"
        case .alreadyConfirmed:  attendanceTitle
        default:                 ""
        }
    }
    private var subtitle: String {
        switch state {
        case .checkInOpen:       "Tap once you're at the door — we use it to settle with the venue and to help if anything goes wrong."
        case .postWindow:        "Tell us how it went so we can sort out support if needed."
        case .alreadyConfirmed:  attendanceSubtitle
        default:                 ""
        }
    }
    private var attendanceTitle: String {
        switch booking.attendanceStatus {
        case "verified_attended": "Confirmed — you were there."
        case "likely_attended":   "Checked in."
        case "user_claimed_attended": "Got it — thanks for letting us know."
        case "no_show":           "Marked as no-show."
        case "disputed":          "We're looking into it."
        default:                  ""
        }
    }
    private var attendanceSubtitle: String {
        switch booking.attendanceStatus {
        case "disputed": "Support will follow up if needed."
        case "no_show":  "If this is wrong, contact support."
        default:         "No action needed."
        }
    }

    // ── Time math ─────────────────────────────────────────────────────────────

    private var bookingTimes: (earliest: Date, base: Date, postCutoff: Date) {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd HH:mm"
        fmt.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let hhmm = (booking.arrivalWindow?.split(separator: "-").first ?? "22:00")
            .trimmingCharacters(in: .whitespaces)
        let base = fmt.date(from: "\(booking.bookingDate) \(hhmm)") ?? Date()
        return (
            earliest:   base.addingTimeInterval(-2 * 3600),
            base:       base,
            postCutoff: base.addingTimeInterval(8 * 3600)
        )
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    private func post(kind: String, reason: IssueReason? = nil) async {
        guard !posting else { return }
        posting = true; feedback = nil
        defer { posting = false }

        var lat: Double?, lng: Double?
        if kind == "user_checkin" || kind == "pass_viewed" {
            do {
                let loc = try await LocationService.shared.currentLocation()
                lat = loc.coordinate.latitude
                lng = loc.coordinate.longitude
            } catch {
                if kind == "user_checkin" {
                    Haptics.error()
                    feedback = (error as? LocalizedError)?.errorDescription ?? "Couldn't read your location."
                    return
                }
                // pass_viewed is best-effort without location.
            }
        }

        do {
            let _: SignalResponse = try await api.post(
                "/api/bookings/\(booking.id.uuidString.lowercased())/signals",
                body: SignalRequest(kind: kind, lat: lat, lng: lng, reason: reason?.value)
            )
            Haptics.success()
            switch kind {
            case "user_checkin":
                feedback = "Checked in. Have a great night."
                // Now that the user has benefited from WhenInUse, iOS will show
                // the upgrade dialog. If they pick Always, the LocationService
                // delegate auto-registers fences for every upcoming booking
                // — that's the "auto-on" path the user asked for. If they
                // don't, nothing changes.
                LocationService.shared.requestAlwaysAuthorization()
            case "post_entry_got_in":    feedback = "Thanks — noted."
            case "post_entry_issue":     feedback = "Sorry to hear that. We'll follow up."
            default: break
            }
            onSignalPosted()
        } catch {
            Haptics.error()
            feedback = friendlyError(error)
        }
    }

    private func friendlyError(_ error: Error) -> String {
        let msg = error.localizedDescription.lowercased()
        if msg.contains("too far") { return "You're too far from the venue to check in." }
        if msg.contains("outside booking window") { return "Check-in isn't open yet — try closer to arrival time." }
        if msg.contains("venue location") { return "We don't have this venue's location yet." }
        return "Couldn't save that. Try again."
    }

    // ── Types ─────────────────────────────────────────────────────────────────

    private struct SignalRequest: Encodable {
        let kind: String
        let lat: Double?
        let lng: Double?
        let reason: String?
    }
    private struct SignalResponse: Decodable, Sendable {
        let logged: String?
        let distanceM: Int?
        enum CodingKeys: String, CodingKey { case logged, distanceM = "distance_m" }
    }

    enum IssueReason: CaseIterable {
        case denied, notOnList, arrivedLate, dressCode, atCapacity, didNotGo, other
        var value: String {
            switch self {
            case .denied:      "denied"
            case .notOnList:   "not_on_list"
            case .arrivedLate: "arrived_late"
            case .dressCode:   "dress_code"
            case .atCapacity:  "at_capacity"
            case .didNotGo:    "did_not_go"
            case .other:       "other"
            }
        }
        var label: String {
            switch self {
            case .denied:      "Denied at the door"
            case .notOnList:   "Not on the list"
            case .arrivedLate: "Arrived too late"
            case .dressCode:   "Dress code issue"
            case .atCapacity:  "Venue at capacity"
            case .didNotGo:    "I didn't go"
            case .other:       "Something else"
            }
        }
    }
}
