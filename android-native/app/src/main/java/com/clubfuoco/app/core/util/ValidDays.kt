package com.clubfuoco.app.core.util

/**
 * Parses an offer's `valid_days` text into weekday indices (0=Sun…6=Sat).
 *
 * Port of ios-native's `ValidDays.swift`, which is itself shared with the
 * promoter app and mirrored by src/lib/valid-days.ts. **Four implementations now
 * have to agree** — change them together, and lean on the parity test
 * (`ValidDaysParityTest`) rather than on reading them side by side.
 *
 * The promoter day-picker writes a canonical form — "Every night" or an explicit
 * comma list of 3-letter abbreviations — and that path is matched exactly first.
 * Legacy rows still carry free-form text, so the fallback accepts:
 *   - "Every night" / "Any night" / "Daily" / "All week" → all seven
 *   - comma / slash / "&" / "and" separated lists, full or short day names
 *   - ranges with "-", "–", "—" or "to": "Thu - Sun" (wraps past Saturday)
 *   - "Weekends" (Fri & Sat, nightlife sense) / "Weekdays" (the complement)
 *
 * Unparseable text yields the empty set — the offer simply isn't shown as
 * running tonight, never a crash.
 */
object ValidDays {
    val all: Set<Int> = (0..6).toSet()

    private val order = listOf("sun", "mon", "tue", "wed", "thu", "fri", "sat")
    private val canonical = mapOf(
        "sun" to 0, "mon" to 1, "tue" to 2, "wed" to 3, "thu" to 4, "fri" to 5, "sat" to 6,
    )

    fun parse(raw: String): Set<Int> {
        val v = raw.trim().lowercase()
        if (v.isEmpty()) return emptySet()

        // Canonical fast path: every part is exactly a 3-letter abbreviation.
        if (v == "every night") return all
        val exactParts = v.split(",").map { it.trim() }
        if (exactParts.isNotEmpty() && exactParts.all { canonical[it] != null }) {
            return exactParts.mapNotNull { canonical[it] }.toSet()
        }

        // Legacy free-form path.
        if (v.contains("every") || v.contains("any") || v.contains("daily") ||
            v.contains("all week") || v.contains("7 nights")
        ) {
            return all
        }
        if (v.contains("weekend")) return setOf(5, 6)          // Fri & Sat nights
        if (v.contains("weekday")) return setOf(0, 1, 2, 3, 4) // their complement

        // Normalize list separators to commas, then handle ranges per part.
        var text = v
        for (sep in listOf(" and ", " & ", "&", "/", "+", ";")) {
            text = text.replace(sep, ",")
        }

        val result = mutableSetOf<Int>()
        for (part in text.split(",")) {
            var seg = part.trim()
            if (seg.isEmpty()) continue
            // Range separators — em/en dash, hyphen, "to", "through".
            for (word in listOf(" through ", " thru ", " to ")) {
                seg = seg.replace(word, "-")
            }
            val ends = seg.split('–', '—', '-')
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            if (ends.size == 2) {
                val a = dayIndex(ends[0])
                val b = dayIndex(ends[1])
                if (a != null && b != null) {
                    // Explicit type: `var i = a` infers Int? and loses the
                    // smart cast the null check just established.
                    var i: Int = a
                    while (true) {
                        result.add(i)
                        if (i == b) break
                        i = (i + 1) % 7
                    }
                    continue
                }
            }
            dayIndex(seg)?.let { result.add(it) }
        }
        return result
    }

    /**
     * Match a free-form segment to a weekday. The substring fallback mirrors the
     * old parser ("thursdays" → thu) but a prefix match wins first, so noise
     * words cannot hijack the segment.
     *
     * A consequence worth knowing: "Sunset sessions" parses as Sunday, because
     * "sun" prefixes it. That is the shipping iOS behaviour and the parity test
     * pins it deliberately.
     */
    private fun dayIndex(segment: String): Int? {
        val s = segment.trim()
        if (s.isEmpty()) return null
        val prefix = order.indexOfFirst { s.startsWith(it) }
        if (prefix >= 0) return prefix
        val contains = order.indexOfFirst { s.contains(it) }
        return if (contains >= 0) contains else null
    }
}
