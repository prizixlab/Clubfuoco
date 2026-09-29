package com.clubfuoco.app.parity

import com.clubfuoco.app.core.util.ValidDays
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Asserts the Kotlin [ValidDays] agrees with the SHIPPING iOS implementation,
 * case for case.
 *
 * The vectors in `parity/valid_days.json` are not hand-written expectations:
 * they are produced by `scripts/parity/gen-validdays.swift`, which compiles the
 * real `ios-native/.../ValidDays.swift` and runs it over a corpus. That
 * distinction is the whole value — a hand-written expectation can agree with a
 * hand-written port and both be wrong about what the app actually does.
 *
 * Regenerate with `scripts/parity/run.sh` whenever the Swift source changes.
 */
class ValidDaysParityTest {

    @Serializable
    data class Vector(val input: String, val days: List<Int>)

    private val vectors: List<Vector> = Json.decodeFromString(
        javaClass.classLoader!!
            .getResourceAsStream("parity/valid_days.json")!!
            .bufferedReader().readText(),
    )

    @Test
    fun `corpus is actually loaded`() {
        assertTrue("no parity vectors found", vectors.size > 20)
    }

    @Test
    fun `matches the iOS implementation for every vector`() {
        val mismatches = vectors.mapNotNull { v ->
            val actual = ValidDays.parse(v.input).sorted()
            if (actual != v.days) "  ${v.input.let { "\"$it\"" }}: iOS=${v.days} kotlin=$actual"
            else null
        }
        assertEquals(
            "ValidDays diverged from iOS on ${mismatches.size} input(s):\n" +
                mismatches.joinToString("\n"),
            emptyList<String>(),
            mismatches,
        )
    }

    /**
     * Pinned separately because it is surprising: "sun" prefixes "sunset", so a
     * venue whose valid_days reads "Sunset sessions" is treated as running on
     * Sundays. Documented here so a future "fix" has to be a deliberate change
     * on all four platforms rather than an accident.
     */
    @Test
    fun `prefix matching quirk is intentional`() {
        assertEquals(setOf(0), ValidDays.parse("Sunset sessions"))
    }
}
