import Foundation

// ── Checks around a Fourvenues booking ───────────────────────────────────────
//
// Small, pure rules the event sheet runs before and after it talks to
// Fourvenues, kept here so each one is readable on its own. The reasons and
// codes are in docs/booking-edge-cases.md (BK-15, BK-22, BK-23, BK-26, FV-U01).

enum FVPhone {
    /// International form for Fourvenues' phone widget, or nil when it can't be
    /// made valid. "+44 7700 900123" stays; "0034 612…" → "+34 612…"; a bare
    /// Spanish mobile/landline (9 digits starting 6–9) gets +34. Anything
    /// else without a country code is refused rather than guessed — gluing
    /// +34 onto a UK number made Fourvenues reject the form.
    static func normalize(_ raw: String) -> String? {
        var t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("00") { t = "+" + t.dropFirst(2) }
        let digits = t.filter(\.isNumber)
        if t.hasPrefix("+") {
            return (8...15).contains(digits.count) ? "+" + digits : nil
        }
        if digits.count == 9, let first = digits.first, "6789".contains(first) {
            return "+34 " + digits
        }
        return nil
    }
}

/// What Fourvenues' refusal means, as one of our own messages. Their raw page
/// text (300 characters of Spanish page chrome) used to be shown as is; it now
/// stays in the trace.
enum FVReject {
    static func key(for raw: String) -> String {
        let s = raw.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
        if s.range(of: #"ya estas? apuntad|already (signed|registered)|ya inscrit"#, options: .regularExpression) != nil {
            return "fv.alreadyOnList"
        }
        if s.range(of: #"completo|agotad|sold ?out|no quedan|lista cerrada|full"#, options: .regularExpression) != nil {
            return "fv.justSoldOut"
        }
        if s.range(of: #"superando el limite|limite|limit"#, options: .regularExpression) != nil {
            return "fv.overLimit"
        }
        if s.contains("algo ha pasado") { return "fv.cantComplete" }
        return "fv.rejected"
    }
}

enum FVAge {
    /// True when the guest will be younger than `minAge` on `night`. Unknown
    /// birthday → false (Fourvenues and the door still check ID).
    static func tooYoung(birthday: String?, minAge: Int?, night: String) -> Bool {
        guard let minAge, minAge > 0, let birthday else { return false }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        f.locale = Locale(identifier: "en_US_POSIX")
        guard let born = f.date(from: String(birthday.prefix(10))), let on = f.date(from: night) else { return false }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = f.timeZone
        let years = cal.dateComponents([.year], from: born, to: on).year ?? 0
        return years < minAge
    }
}

enum FVRelay {
    /// A Sign in with Apple private-relay address. Fourvenues isn't a sender we
    /// registered with Apple, so its ticket email to one never arrives — and
    /// for a guestlist that email is the only way the QR comes (the sign-up
    /// reply carries none). Only safe when the private ticket inbox is in use.
    static func unreachable(_ email: String) -> Bool {
        email.lowercased().hasSuffix("@privaterelay.appleid.com")
    }
}

/// After a sign-up was SENT but never confirmed, the same way in stays locked
/// for a while: the guest may well be on the list already, and a second tap
/// can sign them up twice. The inbox files the ticket if it went through.
enum FVUnconfirmedLock {
    private static let ttl: TimeInterval = 10 * 60
    private static func key(_ productId: String) -> String { "fv.unconfirmed.\(productId)" }

    static func lock(_ productId: String) {
        UserDefaults.standard.set(Date().addingTimeInterval(ttl).timeIntervalSince1970, forKey: key(productId))
    }

    static func isLocked(_ productId: String) -> Bool {
        let until = UserDefaults.standard.double(forKey: key(productId))
        return until > Date().timeIntervalSince1970
    }
}
