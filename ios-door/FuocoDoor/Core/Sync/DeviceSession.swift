import Foundation

/// Persisted enrollment for this door device (§4 trust/security). v1 stores the
/// device token in UserDefaults; the plan calls for Keychain — a small follow-up.
struct DeviceSession: Codable {
    var deviceToken: String
    var venue: String
    var venueName: String
    var enrolledAt: Date

    private static let key = "cf.door.session"

    static func load() -> DeviceSession? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        return try? dec.decode(DeviceSession.self, from: data)
    }
    func save() {
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601
        if let data = try? enc.encode(self) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
    static func clear() { UserDefaults.standard.removeObject(forKey: key) }

    /// The synthetic session used in open-access mode (no enrollment). Not
    /// persisted — it's recreated each launch while `AppMode.openAccess` is on.
    static func openDefault() -> DeviceSession {
        DeviceSession(deviceToken: "open", venue: "open",
                      venueName: "Open access", enrolledAt: Date())
    }
}
