import Foundation

// Shared copy of ios-promoters/FuocoPromoters/Core/Utils/ValidDays.swift — the
// consumer app must accept exactly the grammar the promoter app writes (and the
// web port in src/lib/valid-days.ts mirrors it too). Change all three together.

/// Parses an offer's `valid_days` text into weekday indices (0=Sun…6=Sat).
///
/// The day picker now writes a canonical form — "Every night" or an explicit
/// comma list of 3-letter day abbreviations ("Mon, Tue, Sun") — and that path
/// is matched exactly first. Legacy rows still carry free-form text, so the
/// fallback accepts what the old parser did and more:
///   - "Every night" / "Any night" / "Daily" / "All week"  → all seven
///   - comma / slash / "&" / "and" separated lists, full or short day names
///   - ranges with "-", "–", "—" or "to": "Thu - Sun" (wraps past Saturday)
///   - "Weekends" (Fri & Sat, nightlife sense) / "Weekdays" (the complement)
/// Unparseable text yields the empty set — the offer simply isn't shown as
/// running tonight, never a crash.
enum ValidDays {
    static let all: Set<Int> = Set(0...6)

    private static let order = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
    private static let canonical: [String: Int] = [
        "sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6,
    ]

    static func parse(_ raw: String) -> Set<Int> {
        let v = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !v.isEmpty else { return [] }

        // Canonical fast path: every part is exactly a 3-letter abbreviation.
        if v == "every night" { return all }
        let exactParts = v.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        if !exactParts.isEmpty, exactParts.allSatisfy({ canonical[$0] != nil }) {
            return Set(exactParts.compactMap { canonical[$0] })
        }

        // Legacy free-form path.
        if v.contains("every") || v.contains("any") || v.contains("daily")
            || v.contains("all week") || v.contains("7 nights") { return all }
        if v.contains("weekend") { return [5, 6] }          // Fri & Sat nights
        if v.contains("weekday") { return [0, 1, 2, 3, 4] } // their complement

        // Normalize list separators to commas, then handle ranges per part.
        var text = v
        for sep in [" and ", " & ", "&", "/", "+", ";"] {
            text = text.replacingOccurrences(of: sep, with: ",")
        }

        var result = Set<Int>()
        for part in text.split(separator: ",") {
            var seg = String(part).trimmingCharacters(in: .whitespaces)
            guard !seg.isEmpty else { continue }
            // Range separators — em/en dash, hyphen, "to", "through".
            for word in [" through ", " thru ", " to "] {
                seg = seg.replacingOccurrences(of: word, with: "-")
            }
            let dashes = CharacterSet(charactersIn: "–—-")
            let ends = seg.components(separatedBy: dashes)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            if ends.count == 2, let a = dayIndex(ends[0]), let b = dayIndex(ends[1]) {
                var i = a
                while true {
                    result.insert(i)
                    if i == b { break }
                    i = (i + 1) % 7
                }
                continue
            }
            if let d = dayIndex(seg) { result.insert(d) }
        }
        return result
    }

    /// Match a free-form segment to a weekday. Substring match mirrors the old
    /// parser ("thursdays" → thu) but prefers a match at the start of the
    /// segment so noise words can't hijack it.
    private static func dayIndex(_ segment: String) -> Int? {
        let s = segment.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return nil }
        if let i = order.firstIndex(where: { s.hasPrefix($0) }) { return i }
        return order.firstIndex { s.contains($0) }
    }

    #if DEBUG
    /// Unit-level confidence without a test target: assert the contract on
    /// debug launches. Any regression trips immediately on device.
    static func runSelfChecks() {
        assert(parse("Every night") == all)
        assert(parse("every night!") == all)
        assert(parse("Any night") == all)
        assert(parse("Daily") == all)
        assert(parse("") == [])
        assert(parse("Mon, Tue, Sun") == [1, 2, 0])          // canonical list
        assert(parse("Fri") == [5])
        assert(parse("Fridays & Saturdays") == [5, 6])
        assert(parse("Thu - Sun") == [4, 5, 6, 0])           // range
        assert(parse("Thu – Sun") == [4, 5, 6, 0])           // en dash
        assert(parse("Thursday — Sunday") == [4, 5, 6, 0])   // em dash, full names
        assert(parse("Fri to Sat") == [5, 6])
        assert(parse("Sat - Mon") == [6, 0, 1])              // wraps past Saturday
        assert(parse("Mon-Wed, Fri") == [1, 2, 3, 5])        // mixed range + list
        assert(parse("Weekends") == [5, 6])
        assert(parse("Weekdays") == [0, 1, 2, 3, 4])
        assert(parse("Tuesdays") == [2])
        assert(parse("closed") == [])                        // unparseable → empty
    }
    #endif
}
