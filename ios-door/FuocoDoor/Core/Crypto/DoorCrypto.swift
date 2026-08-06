import Foundation
import CryptoKit
import CommonCrypto

/// Client half of the encrypted night pack (mirrors src/lib/door-crypto.ts).
///
/// The cache holds no key. Each entry is opened with material derived from the
/// QR that was just scanned, so the file is inert without the physical code —
/// losing the phone leaks nothing but counts.
enum DoorCrypto {
    static let pbkdf2Iterations: UInt32 = 120_000
    private static let hkdfInfo = Data("fuoco-door-v1".utf8)

    /// 64 bytes: [0..32) lookup id, [32..64) key-wrapping key.
    /// Strong (128-bit) tokens take the fast HKDF path; the legacy ~41-bit CF-
    /// codes take PBKDF2, which is what makes brute-forcing the cache infeasible.
    static func derive(token: String, salt: Data, legacy: Bool) -> (lookup: Data, key: Data)? {
        let material: Data
        if legacy {
            guard let d = pbkdf2(password: token, salt: salt, outputLength: 64) else { return nil }
            material = d
        } else {
            let key = HKDF<SHA256>.deriveKey(
                inputKeyMaterial: SymmetricKey(data: Data(token.utf8)),
                salt: salt, info: hkdfInfo, outputByteCount: 64)
            material = key.withUnsafeBytes { Data($0) }
        }
        return (material.prefix(32), material.suffix(32))
    }

    /// Server appends the GCM tag to the ciphertext; split it back off.
    static func gcmOpen(key: Data, ivHex: String, payloadHex: String) -> Data? {
        guard let iv = Data(hexString: ivHex), let blob = Data(hexString: payloadHex),
              blob.count > 16 else { return nil }
        let ct = blob.prefix(blob.count - 16)
        let tag = blob.suffix(16)
        guard let box = try? AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv),
                                               ciphertext: ct, tag: tag) else { return nil }
        return try? AES.GCM.open(box, using: SymmetricKey(data: key))
    }

    private static func pbkdf2(password: String, salt: Data, outputLength: Int) -> Data? {
        var out = Data(count: outputLength)
        let pw = Array(password.utf8)
        let result = out.withUnsafeMutableBytes { outBuf -> Int32 in
            salt.withUnsafeBytes { saltBuf in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2), pw, pw.count,
                    saltBuf.bindMemory(to: UInt8.self).baseAddress, salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), pbkdf2Iterations,
                    outBuf.bindMemory(to: UInt8.self).baseAddress, outputLength)
            }
        }
        return result == kCCSuccess ? out : nil
    }
}

extension Data {
    init?(hexString: String) {
        let n = hexString.count
        guard n % 2 == 0 else { return nil }
        var d = Data(capacity: n / 2)
        var i = hexString.startIndex
        while i < hexString.endIndex {
            let j = hexString.index(i, offsetBy: 2)
            guard let b = UInt8(hexString[i..<j], radix: 16) else { return nil }
            d.append(b)
            i = j
        }
        self = d
    }
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
