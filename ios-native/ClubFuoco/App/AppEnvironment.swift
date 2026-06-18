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
    let membershipStore: MembershipStore

    init() {
        let supabase = SupabaseService()
        self.supabase = supabase
        self.api = APIClient(tokenProvider: supabase)
        self.queries = Queries(supabase: supabase)
        self.authStore = AuthStore(supabase: supabase, queries: queries)
        self.localeStore = LocaleStore()
        self.planStore = PlanStore()
        self.membershipStore = MembershipStore(api: api)

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
                return .init(bookingId: b.id, clubLat: lat, clubLng: lng,
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

        // Cold-start sync — if the user already granted Always in an earlier
        // session, restore the fences before anyone touches the UI.
        Task { await LocationService.shared.syncGeofences() }
    }
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
