package com.clubfuoco.app.parity

import com.clubfuoco.app.models.VenueMatch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Asserts the Kotlin [VenueMatch] agrees with the shipping iOS implementation.
 *
 * Vectors come from `scripts/parity/venuematch`, compiled against the real
 * `ExternalEvent.swift`. The corpus is the union of the Swift self-checks and
 * the web's venue-match.test.ts, so it already encodes every regression the
 * matcher was written to fix — most importantly that generic words
 * ("rooftop", "beach club") must never be enough to match two venues.
 */
class VenueMatchParityTest {

    @Serializable
    data class Vector(val a: String, val b: String, val match: Boolean)

    private val vectors: List<Vector> = Json.decodeFromString(
        javaClass.classLoader!!
            .getResourceAsStream("parity/venue_match.json")!!
            .bufferedReader().readText(),
    )

    @Test
    fun `corpus covers both outcomes`() {
        assertTrue(vectors.any { it.match })
        assertTrue(vectors.any { !it.match })
    }

    @Test
    fun `matches the iOS implementation for every pair`() {
        val mismatches = vectors.mapNotNull { v ->
            val actual = VenueMatch.matches(v.a, v.b)
            if (actual != v.match) "  \"${v.a}\" ~ \"${v.b}\": iOS=${v.match} kotlin=$actual"
            else null
        }
        assertEquals(
            "VenueMatch diverged from iOS on ${mismatches.size} pair(s):\n" +
                mismatches.joinToString("\n"),
            emptyList<String>(),
            mismatches,
        )
    }

    /**
     * The regression the current matcher exists for: an earlier version matched
     * on a single generic word, so an event at "Azimuth Rooftop Bar" attached
     * itself to "Azul Rooftop Barceloneta".
     */
    @Test
    fun `generic words alone never match`() {
        assertTrue(!VenueMatch.matches("Azul Rooftop Barceloneta", "Azimuth Rooftop Bar"))
        assertTrue(!VenueMatch.matches("Almar Beach Club", "El Kabron Beach Club"))
    }
}
