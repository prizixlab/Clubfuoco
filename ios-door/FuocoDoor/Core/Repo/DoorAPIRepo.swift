import Foundation

/// Real backend client for the /api/door/* endpoints (§5). These routes are NOT
/// built yet — this is written to the planned contract so it's a drop-in once
/// the server ships. Until then RepoFactory.useMock keeps MockDoorRepo active.
struct DoorAPIRepo: DoorRepo {
    // Same Vercel API the consumer app uses (ios-native APIClient.defaultBaseURL).
    static let baseURL = URL(string: "https://clubfuoco.vercel.app")!

    private func request(_ path: String, method: String = "POST",
                         body: Encodable? = nil, deviceToken: String? = nil) async throws -> Data {
        // Plain string join, not appendingPathComponent — the latter percent-
        // encodes `?`/`&` in query strings (e.g. the manifest endpoint).
        guard let url = URL(string: Self.baseURL.absoluteString + "/" + path) else {
            throw DoorRepoError.server("Bad URL")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let deviceToken { req.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization") }
        if let body {
            let enc = JSONEncoder()
            enc.keyEncodingStrategy = .convertToSnakeCase
            enc.dateEncodingStrategy = .iso8601
            req.httpBody = try enc.encode(AnyEncodable(body))
        }
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw DoorRepoError.offline }
            guard (200..<300).contains(http.statusCode) else {
                throw DoorRepoError.server("Server error \(http.statusCode)")
            }
            return data
        } catch let e as DoorRepoError {
            throw e
        } catch {
            throw DoorRepoError.offline
        }
    }

    /// All routes wrap payloads in the app's `{ data, error }` envelope (ok/err).
    private func decode<T: Decodable>(_ data: Data) throws -> T {
        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        dec.dateDecodingStrategy = .iso8601
        let env = try dec.decode(Envelope<T>.self, from: data)
        if let error = env.error { throw DoorRepoError.server(error) }
        guard let value = env.data else { throw DoorRepoError.server("Empty response") }
        return value
    }

    func enroll(code: String) async throws -> EnrollResult {
        struct Body: Encodable { let code: String }
        let data = try await request("api/door/enroll", body: Body(code: code))
        return try decode(data)
    }

    func resolve(_ payload: String) async throws -> AccessDescriptor {
        struct Body: Encodable { let payload: String }
        let data = try await request("api/door/resolve", body: Body(payload: payload))
        return try decode(data)
    }

    func record(_ scan: QueuedScan) async throws {
        struct Body: Encodable {
            let scanId: UUID; let action: String; let tokenRef: String
            let count: Int; let kind: String; let holderName: String; let reason: String?
        }
        _ = try await request("api/door/admit", body: Body(
            scanId: scan.scanId, action: scan.action.rawValue, tokenRef: scan.tokenRef,
            count: scan.count, kind: scan.kind.rawValue,
            holderName: scan.holderName, reason: scan.reason))
    }

    func venues(date: String?) async throws -> [DoorVenue] {
        struct Resp: Decodable { let venues: [DoorVenue] }
        let path = date.map { "api/door/venues?date=\($0)" } ?? "api/door/venues"
        let data = try await request(path, method: "GET")
        return (try decode(data) as Resp).venues
    }

    func nightPack(venue: String, date: String) async throws -> EncryptedManifest {
        let data = try await request("api/door/night?venue=\(venue)&date=\(date)", method: "GET")
        return try decode(data)
    }

    func fetchManifest(venue: String, date: String, deviceToken: String) async throws -> NightManifest {
        let data = try await request("api/door/manifest?venue=\(venue)&date=\(date)",
                                     method: "GET", deviceToken: deviceToken)
        let m: NightManifest = try decode(data)
        // The plan requires rejecting tampered caches — signature verification
        // (server public key) lands with the real endpoint.
        return m
    }

    func sync(scans: [QueuedScan], venue: String, date: String, deviceToken: String) async throws -> SyncResult {
        struct Body: Encodable { let venue: String; let date: String; let scans: [QueuedScan] }
        let data = try await request("api/door/sync",
                                     body: Body(venue: venue, date: date, scans: scans),
                                     deviceToken: deviceToken)
        return try decode(data)
    }
}

/// The app's standard `{ data, error }` response envelope (ok/err helpers).
private struct Envelope<U: Decodable>: Decodable { let data: U?; let error: String? }

/// Type-erasing wrapper so `request` can take `Encodable` bodies.
private struct AnyEncodable: Encodable {
    private let encodeFn: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { encodeFn = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeFn(encoder) }
}
