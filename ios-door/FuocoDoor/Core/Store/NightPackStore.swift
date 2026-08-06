import Foundation
import CryptoKit
import Security

// MARK: - Wire format (mirrors the server's SealedEntry)

struct SealedEntry: Codable {
    let lookup: String
    let legacy: Bool
    let salt: String
    let wrapIv: String
    let wrap: String
    let blobIv: String
    let blob: String
    let allowed: Int
    let used: Int
    let billable: Bool
    let tokenRef: String
}

struct EncryptedManifest: Codable {
    let venue: String
    let venueName: String
    let night: String
    let issuedAt: String
    let serverTime: String
    let entries: [SealedEntry]
    let scheme: String
}

/// The plaintext hidden inside each entry — only ever materialised for the one
/// guest whose QR was just scanned.
struct SealedPayload: Codable {
    let holderName: String
    let holderAvatarUrl: String?
    let kind: CredentialKind
    let entitlement: Entitlement
}

/// Holds the downloaded night pack for offline scanning.
///
/// Two independent layers, because they defend different things:
///  • Per-entry encryption keyed by each guest's QR — defeats reading the guest
///    list at all, even with the app open and the phone unlocked.
///  • A Keychain-held file key + NSFileProtectionComplete — defeats pulling the
///    file off a stolen or backed-up device. Belt and braces; the first layer is
///    the one that actually satisfies "not readable without a scan".
@MainActor
final class NightPackStore: ObservableObject {
    @Published private(set) var manifest: EncryptedManifest?
    @Published private(set) var downloadedAt: Date?

    private let fileURL: URL
    private static let keychainTag = "com.clubfuoco.door.packkey"

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("FuocoDoor", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("nightpack.bin")
        load()
    }

    // MARK: Scan-time lookup

    /// Find and open the entry a scanned payload unlocks. Returns nil when the
    /// pack has no such code — which is also what a tampered cache produces,
    /// since GCM authentication fails closed.
    func open(payload: String) -> AccessDescriptor? {
        guard let m = manifest else { return nil }
        let token = Self.normalise(payload)

        // Strong entries first: HKDF is ~0.02ms, so scanning a modern ticket
        // never pays the legacy PBKDF2 cost.
        for legacy in [false, true] {
            for e in m.entries where e.legacy == legacy {
                guard let salt = Data(hexString: e.salt),
                      let d = DoorCrypto.derive(token: token, salt: salt, legacy: legacy)
                else { continue }
                guard d.lookup.hexString == e.lookup else { continue }
                guard let ck = DoorCrypto.gcmOpen(key: d.key, ivHex: e.wrapIv, payloadHex: e.wrap),
                      let plain = DoorCrypto.gcmOpen(key: ck, ivHex: e.blobIv, payloadHex: e.blob),
                      let p = try? Self.decoder.decode(SealedPayload.self, from: plain)
                else { continue }
                return AccessDescriptor(
                    holderName: p.holderName, holderAvatarUrl: p.holderAvatarUrl,
                    kind: p.kind, entitlement: p.entitlement,
                    allowance: Allowance(used: e.used, allowed: e.allowed),
                    status: e.used >= e.allowed && e.used > 0 ? .over : .ok,
                    venue: m.venue, venueName: m.venueName, night: m.night,
                    tokenRef: e.tokenRef)
            }
        }
        return nil
    }

    /// Guest QRs carry a `fuoco-invite:` prefix; bookings encode a bare token or
    /// a /verify/ URL. The key is derived from the bare secret, so strip wrappers.
    static func normalise(_ payload: String) -> String {
        let p = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        if let r = p.range(of: "fuoco-invite:", options: .caseInsensitive) {
            return String(p[r.upperBound...])
        }
        if let r = p.range(of: "/verify/", options: .caseInsensitive) {
            return String(p[r.upperBound...]).components(separatedBy: CharacterSet(charactersIn: "?#/")).first ?? p
        }
        return p
    }

    // MARK: Persistence

    func store(_ m: EncryptedManifest) {
        manifest = m
        downloadedAt = Date()
        guard let plain = try? Self.encoder.encode(m), let key = Self.fileKey() else { return }
        guard let sealed = try? AES.GCM.seal(plain, using: key).combined else { return }
        try? sealed.write(to: fileURL, options: [.atomic, .completeFileProtection])
        UserDefaults.standard.set(downloadedAt, forKey: "cf.door.packAt")
    }

    func clear() {
        manifest = nil; downloadedAt = nil
        try? FileManager.default.removeItem(at: fileURL)
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL), let key = Self.fileKey(),
              let box = try? AES.GCM.SealedBox(combined: data),
              let plain = try? AES.GCM.open(box, using: key),
              let m = try? Self.decoder.decode(EncryptedManifest.self, from: plain)
        else { return }
        manifest = m
        downloadedAt = UserDefaults.standard.object(forKey: "cf.door.packAt") as? Date
    }

    // MARK: Keychain file key

    /// 256-bit key, created once. ThisDeviceOnly so it never rides an iCloud
    /// backup to another handset.
    private static func fileKey() -> SymmetricKey? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keychainTag,
            kSecReturnData as String: true,
        ]
        var item: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
           let d = item as? Data { return SymmetricKey(data: d) }

        var bytes = Data(count: 32)
        let ok = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard ok == errSecSuccess else { return nil }
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keychainTag,
            kSecValueData as String: bytes,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        SecItemAdd(add as CFDictionary, nil)
        return SymmetricKey(data: bytes)
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; return d
    }()
    private static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.keyEncodingStrategy = .convertToSnakeCase; return e
    }()
}
