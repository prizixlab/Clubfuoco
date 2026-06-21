import CoreLocation
import Foundation

/// Foreground reads + background geofencing for the attendance system.
///
/// Two responsibilities behind one singleton because both share the same
/// CLLocationManager + delegate identity:
///
///   1. Foreground: one-shot `currentLocation()` for the "I'm here" tap and
///      the passive `pass_viewed` on booking-detail appear. Triggers
///      `requestWhenInUseAuthorization` lazily.
///
///   2. Background: when the user has granted `.authorizedAlways`, register
///      a CLCircularRegion (~200m) around each upcoming venue, active for
///      the booking night. iOS wakes the app on region entry and fires
///      `user_checkin` + `geo_presence` signals via APIClient. No
///      `UIBackgroundModes: location` is needed — region monitoring does
///      this on its own.
///
/// Posture is "auto-on when granted, auto-off when not" — there is no in-app
/// toggle. The user controls everything from Settings → Privacy → Location.
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    enum LocationError: Error, LocalizedError {
        case denied, restricted, unavailable, timeout
        var errorDescription: String? {
            switch self {
            case .denied:      "Location access denied. Enable it in Settings."
            case .restricted:  "Location access restricted on this device."
            case .unavailable: "Couldn't read your location. Try again."
            case .timeout:     "Couldn't read your location in time. Try again."
            }
        }
    }

    private let manager = CLLocationManager()
    private var pending: CheckedContinuation<CLLocation, Error>?
    private var timeoutTask: Task<Void, Never>?

    /// Geofence radius in metres. iOS clamps to the hardware floor (~100m) and
    /// CLLocationManager.maximumRegionMonitoringDistance ceiling.
    private static let geofenceRadius: CLLocationDistance = 200
    private static let geofencePrefix = "cf.booking."
    private static let inviteGeofencePrefix = "cf.invite."
    /// Hard limit per app, set by iOS.
    private static let maxRegions = 20

    /// Provider for the background sync — refreshes the fence list whenever
    /// the app sees new bookings or authorization flips to Always. Wired by
    /// `AppEnvironment.bootstrapLocation` so this file stays UI-/store-free.
    var bookingFenceProvider: (() async -> [GeofencedBooking])?
    /// Same shape, but for promoter-invite claims. Identifier prefix differs
    /// so we can route enter events to the correct check-in endpoint.
    var inviteFenceProvider: (() async -> [GeofencedBooking])?
    /// Called from `didEnterRegion` for booking fences. Wired the same way
    /// — POSTs the signals via APIClient so this service has no networking
    /// dependency itself.
    var onRegionEntered: ((_ bookingId: UUID, _ at: Date) async -> Void)?
    /// Called from `didEnterRegion` for promoter-invite fences.
    var onInviteRegionEntered: ((_ guestId: UUID, _ at: Date) async -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        // Region monitoring keeps working across launches; this just receives
        // the wake-up event when one fires.
    }

    // ── Foreground one-shot ──────────────────────────────────────────────────

    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

    /// Read the device's current location. Triggers WhenInUse the first time.
    func currentLocation() async throws -> CLLocation {
        switch manager.authorizationStatus {
        case .denied:     throw LocationError.denied
        case .restricted: throw LocationError.restricted
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            try await Task.sleep(nanoseconds: 600_000_000)
            if manager.authorizationStatus == .denied { throw LocationError.denied }
        default: break
        }

        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<CLLocation, Error>) in
            pending = cont
            manager.requestLocation()
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 12_000_000_000)
                await MainActor.run {
                    guard let self, let p = self.pending else { return }
                    self.pending = nil
                    p.resume(throwing: LocationError.timeout)
                }
            }
        }
    }

    /// Opportunistically prompt the user to upgrade WhenInUse → Always. iOS
    /// will only show the upgrade dialog if the app has already been granted
    /// WhenInUse — calling on Always is a no-op, on .notDetermined falls back
    /// to the first-time prompt.
    func requestAlwaysAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    // ── Background geofences ─────────────────────────────────────────────────

    struct GeofencedBooking: Sendable {
        enum Kind: Sendable { case booking, invite }
        var kind: Kind = .booking
        let id: UUID
        let clubLat: Double
        let clubLng: Double
        /// Local-night cutoffs — fences are registered while `now` is between
        /// these, and dropped otherwise.
        let activeFrom: Date
        let activeUntil: Date
        // Backwards-compatible accessor for existing call sites that still
        // refer to `bookingId`.
        var bookingId: UUID { id }
    }

    /// Sync the active fence list against the booking provider. Safe to call
    /// from app launch, on authorization change, and after a fresh bookings
    /// fetch. Silent no-op without Always authorization.
    func syncGeofences() async {
        guard manager.authorizationStatus == .authorizedAlways else {
            clearAllFences()
            return
        }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }

        let now = Date()

        // Bookings + invites share the same per-app limit. Bookings get
        // priority — paid tickets > free guestlist invites.
        async let bookings = (bookingFenceProvider?() ?? [])
        async let invites = (inviteFenceProvider?() ?? [])
        let booked = await bookings
            .filter { now < $0.activeUntil }
            .sorted { $0.activeFrom < $1.activeFrom }
        let invited = await invites
            .filter { now < $0.activeUntil }
            .sorted { $0.activeFrom < $1.activeFrom }
        let allCandidates = (booked + invited).prefix(Self.maxRegions)

        let desiredIds = Set(allCandidates.map { c -> String in
            (c.kind == .invite ? Self.inviteGeofencePrefix : Self.geofencePrefix)
                + c.id.uuidString.lowercased()
        })

        // Drop fences we no longer want — only clear our own (either prefix).
        for region in manager.monitoredRegions {
            let id = region.identifier
            if id.hasPrefix(Self.geofencePrefix) || id.hasPrefix(Self.inviteGeofencePrefix) {
                if !desiredIds.contains(id) {
                    manager.stopMonitoring(for: region)
                }
            }
        }

        // Add new ones; re-add is idempotent (CL replaces by identifier).
        for c in allCandidates where now >= c.activeFrom {
            let prefix = c.kind == .invite ? Self.inviteGeofencePrefix : Self.geofencePrefix
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: c.clubLat, longitude: c.clubLng),
                radius: Self.geofenceRadius,
                identifier: prefix + c.id.uuidString.lowercased()
            )
            region.notifyOnEntry = true
            region.notifyOnExit  = false
            manager.startMonitoring(for: region)
        }
    }

    func clearAllFences() {
        for region in manager.monitoredRegions
            where region.identifier.hasPrefix(Self.geofencePrefix)
               || region.identifier.hasPrefix(Self.inviteGeofencePrefix) {
            manager.stopMonitoring(for: region)
        }
    }

    // ── CLLocationManagerDelegate ────────────────────────────────────────────

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            self.timeoutTask?.cancel()
            self.pending?.resume(returning: loc)
            self.pending = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.timeoutTask?.cancel()
            self.pending?.resume(throwing: LocationError.unavailable)
            self.pending = nil
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            await self.syncGeofences()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        let id = region.identifier
        let now = Date()
        if id.hasPrefix(Self.geofencePrefix) {
            let raw = String(id.dropFirst(Self.geofencePrefix.count))
            guard let bookingId = UUID(uuidString: raw) else { return }
            Task { await self.onRegionEntered?(bookingId, now) }
        } else if id.hasPrefix(Self.inviteGeofencePrefix) {
            let raw = String(id.dropFirst(Self.inviteGeofencePrefix.count))
            guard let guestId = UUID(uuidString: raw) else { return }
            Task { await self.onInviteRegionEntered?(guestId, now) }
        }
    }
}

extension CLLocation {
    func distanceMeters(toLat lat: Double?, lng: Double?) -> Double? {
        guard let lat, let lng else { return nil }
        return distance(from: CLLocation(latitude: lat, longitude: lng))
    }
}
