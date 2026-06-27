import SwiftUI
import UserNotifications

/// Composition root. Builds the service graph once and hands the pieces to
/// SwiftUI via `.environment`. Mirrors the provider stack in the web app's
/// root layout (AuthProvider / LocaleProvider / PlanProvider).
@MainActor
final class AppEnvironment {
    let supabase: SupabaseService
    let api: APIClient
    let queries: Queries
    let authStore: AuthStore
    let localeStore: LocaleStore
    let planStore: PlanStore

    init() {
        let supabase = SupabaseService()
        self.supabase = supabase
        self.api = APIClient(tokenProvider: supabase)
        self.queries = Queries(supabase: supabase)
        self.authStore = AuthStore(supabase: supabase, queries: queries)
        self.localeStore = LocaleStore()
        self.planStore = PlanStore()

        UNUserNotificationCenter.current().delegate = NotificationForegroundDelegate.shared
        bootstrapLocation()
    }

    /// Wire the LocationService to the rest of the app — the service stays
    /// dependency-free; this closure injects how to find upcoming bookings
    /// and how to post the geofence signal. Safe to call at App.init: any
    /// background-launched event (region entry on a killed app) waits on the
    /// `Task` inside the entry handler until the Supabase session restores.
    private func bootstrapLocation() {
        let queries = self.queries
        let api = self.api

        LocationService.shared.bookingFenceProvider = {
            // Direct PostgREST read — same path as BookingsView. Returns empty
            // when signed out, which collapses to a no-op fence sync.
            let resp = try? await queries.myBookings()
            return (resp?.bookings ?? []).compactMap { b -> LocationService.GeofencedBooking? in
                guard b.status != "cancelled",
                      let lat = b.club?.lat, let lng = b.club?.lng
                else { return nil }
                let (from, until) = activeNightBounds(for: b)
                return .init(kind: .booking, id: b.id,
                             clubLat: lat, clubLng: lng,
                             activeFrom: from, activeUntil: until)
            }
        }

        // Promoter-invite geofences — claimed invites stored locally in
        // InviteClaimsStore. We fetch each invite's night details lazily and
        // register a region around the venue for the active window.
        LocationService.shared.inviteFenceProvider = {
            // Built entirely from locally-pinned claim data — no network, so a
            // background launch (or offline) still restores fences, and a
            // series claim stays bound to the exact occurrence it was made for.
            let claims = await InviteClaimsStore.shared.all()
            let now = Date()
            return claims.compactMap { claim -> LocationService.GeofencedBooking? in
                // Honor the event's auto check-in setting — no fence when off.
                guard claim.autoCheckin,
                      let lat = claim.lat, let lng = claim.lng,
                      let guestUUID = UUID(uuidString: claim.guestId) else { return nil }
                let (from, until) = activeNightBounds(forDate: claim.nightDate,
                                                      openTime: claim.openTime)
                guard now < until else { return nil }
                return .init(kind: .invite, id: guestUUID,
                             clubLat: lat, clubLng: lng,
                             activeFrom: from, activeUntil: until)
            }
        }

        LocationService.shared.onRegionEntered = { bookingId, at in
            struct Body: Encodable { let kind: String }
            struct Resp: Decodable, Sendable { let logged: String? }
            // Posting `user_checkin` here — iOS only fires didEnterRegion once
            // we cross the boundary, which is a stronger signal than passive
            // geo_presence. Server rejects if booking is outside the window,
            // so a fence that lingers past the cutoff just no-ops.
            let path = "/api/bookings/\(bookingId.uuidString.lowercased())/signals"
            let _: Resp? = try? await api.post(path, body: Body(kind: "user_checkin"))
            _ = at
        }

        LocationService.shared.onInviteRegionEntered = { guestId, _ in
            struct Empty: Encodable {}
            struct Resp: Decodable, Sendable { let checkedInAt: String? }
            let path = "/api/promoter-invites/guest/\(guestId.uuidString.lowercased())/checkin"
            let _: Resp? = try? await api.post(path, body: Empty())
        }

        // Cold-start sync — if the user already granted Always in an earlier
        // session, restore the fences before anyone touches the UI.
        Task { await LocationService.shared.syncGeofences() }
    }
}

/// Same 2h-before / 8h-after window, but for a promoter-invite's date string
/// (yyyy-MM-dd) + optional opening time. Falls back to 22:00 (matches the
/// nightlife default the bookings version uses).
@MainActor
private func activeNightBounds(forDate ymd: String, openTime: String?) -> (Date, Date) {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd HH:mm"
    fmt.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
    let hhmm = openTime.map { String($0.prefix(5)) } ?? "22:00"
    let base = fmt.date(from: "\(ymd) \(hhmm)") ?? Date()
    return (base.addingTimeInterval(-2 * 3600), base.addingTimeInterval(8 * 3600))
}

/// Local-night window for a booking — 2h before the arrival window through
/// 8h after, mirroring the server's accepted range in `/api/bookings/:id/signals`.
@MainActor
private func activeNightBounds(for booking: Booking) -> (Date, Date) {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd HH:mm"
    fmt.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
    let hhmm = (booking.arrivalWindow?.split(separator: "-").first ?? "22:00")
        .trimmingCharacters(in: .whitespaces)
    let base = fmt.date(from: "\(booking.bookingDate) \(hhmm)") ?? Date()
    return (base.addingTimeInterval(-2 * 3600), base.addingTimeInterval(8 * 3600))
}

// ── Environment key for the (non-Observable) API client ──────────────────────

private struct APIClientKey: EnvironmentKey {
    static let defaultValue: APIClient = APIClient(tokenProvider: NoTokenProvider())
}

extension EnvironmentValues {
    var api: APIClient {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
}

/// Placeholder used only for the SwiftUI environment default value
/// (previews / accidental missing injection) — sends no Authorization header.
private struct NoTokenProvider: AuthTokenProvider {
    func accessToken() async -> String? { nil }
    func refreshSession() async -> String? { nil }
}
