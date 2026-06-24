import Foundation

/// Supplies a valid Supabase access token for the `Authorization: Bearer`
/// header. Implemented by SupabaseService (which refreshes expired sessions
/// before returning). Mirrors getAuthHeader() in src/lib/api.ts.
protocol AuthTokenProvider: Sendable {
    /// Current access token, refreshed if expired. nil when signed out.
    func accessToken() async -> String?
    /// Force a session refresh (after an unexpected 401). Returns the new token.
    func refreshSession() async -> String?
}

/// Every API route responds `{ "data": T | null, "error": string | null }`
/// (ok()/err() in src/lib/utils.ts).
struct APIEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
    let data: T?
    let error: String?
}

enum APIError: Error, LocalizedError {
    /// Non-2xx with a server-supplied message (the envelope's `error`).
    case http(status: Int, message: String)
    /// 401 that survived one token refresh + retry.
    case unauthorized
    /// 2xx but the envelope had no data and no error.
    case emptyData
    case decoding(Error)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .http(let status, let message): return "\(message) (HTTP \(status))"
        case .unauthorized: return "Unauthorized"
        case .emptyData: return "Empty response"
        case .decoding(let e): return "Decoding failed: \(e.localizedDescription)"
        case .network(let e): return e.localizedDescription
        }
    }
}

/// Typed client for the Vercel REST API (`https://clubfuoco.vercel.app/api/*`).
/// Counterpart of apiFetch() in src/lib/api.ts: prefixes the production host
/// and attaches the Supabase session as a Bearer token on every request.
actor APIClient {
    static let defaultBaseURL = URL(string: "https://clubfuoco.vercel.app")!

    private let baseURL: URL
    private let tokenProvider: AuthTokenProvider
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(tokenProvider: AuthTokenProvider, baseURL: URL = APIClient.defaultBaseURL) {
        self.tokenProvider = tokenProvider
        self.baseURL = baseURL

        // Hard caps so a stalled TCP connection (Apple App Review uses an
        // IPv6-only NAT64 network — a single unreachable edge is the canonical
        // trigger) surfaces as an error in seconds instead of hanging the UI.
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        self.encoder = encoder
    }

    // ── Public surface ────────────────────────────────────────────────────────

    func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await send(method: "GET", path: path, query: query, body: nil)
    }

    func post<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await send(method: "POST", path: path, query: [], body: nil)
    }

    func post<T: Decodable & Sendable>(_ path: String, body: some Encodable) async throws -> T {
        try await send(method: "POST", path: path, query: [], body: try encoder.encode(body))
    }

    func patch<T: Decodable & Sendable>(_ path: String, body: some Encodable) async throws -> T {
        try await send(method: "PATCH", path: path, query: [], body: try encoder.encode(body))
    }

    func put<T: Decodable & Sendable>(_ path: String, body: some Encodable) async throws -> T {
        try await send(method: "PUT", path: path, query: [], body: try encoder.encode(body))
    }

    func delete<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await send(method: "DELETE", path: path, query: [], body: nil)
    }

    /// Some routes (e.g. DELETE /api/friends) take a JSON body on DELETE.
    func delete<T: Decodable & Sendable>(_ path: String, body: some Encodable) async throws -> T {
        try await send(method: "DELETE", path: path, query: [], body: try encoder.encode(body))
    }

    /// Raw (non-envelope) GET — used for binary payloads like .pkpass files.
    func rawData(_ path: String) async throws -> Data {
        let token = await tokenProvider.accessToken()
        let (data, response) = try await perform(method: "GET", path: path, query: [], body: nil, token: token)
        guard (200...299).contains(response.statusCode) else {
            throw APIError.http(status: response.statusCode, message: HTTPURLResponse.localizedString(forStatusCode: response.statusCode))
        }
        return data
    }

    // ── Pipeline ──────────────────────────────────────────────────────────────

    private func send<T: Decodable & Sendable>(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Data?
    ) async throws -> T {
        let token = await tokenProvider.accessToken()
        let (data, response) = try await perform(method: method, path: path, query: query, body: body, token: token)

        // One refresh + retry on 401, then give up — same contract the web
        // client gets from supabase-js's autoRefreshToken.
        if response.statusCode == 401 {
            if let fresh = await tokenProvider.refreshSession(), fresh != token {
                let (data2, response2) = try await perform(method: method, path: path, query: query, body: body, token: fresh)
                if response2.statusCode == 401 { throw APIError.unauthorized }
                return try decodeEnvelope(data2, status: response2.statusCode)
            }
            throw APIError.unauthorized
        }

        return try decodeEnvelope(data, status: response.statusCode)
    }

    private func perform(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Data?,
        token: String?
    ) async throws -> (Data, HTTPURLResponse) {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }

        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.network(URLError(.badServerResponse))
            }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.network(error)
        }
    }

    private func decodeEnvelope<T: Decodable & Sendable>(_ data: Data, status: Int) throws -> T {
        let envelope: APIEnvelope<T>
        do {
            envelope = try decoder.decode(APIEnvelope<T>.self, from: data)
        } catch {
            // Non-envelope body (e.g. middleware redirect HTML) — surface the status.
            if !(200...299).contains(status) {
                throw APIError.http(status: status, message: HTTPURLResponse.localizedString(forStatusCode: status))
            }
            throw APIError.decoding(error)
        }

        if !(200...299).contains(status) {
            throw APIError.http(status: status, message: envelope.error ?? HTTPURLResponse.localizedString(forStatusCode: status))
        }
        if let error = envelope.error {
            throw APIError.http(status: status, message: error)
        }
        guard let value = envelope.data else { throw APIError.emptyData }
        return value
    }
}
