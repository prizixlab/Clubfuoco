package com.clubfuoco.app.core.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Splitting a stored number back into a dial code and a national part.
 *
 * Worth testing because the failure is SILENT: a mis-split shows the wrong flag
 * and a mangled number, and the only symptom anyone reports is "my number looks
 * wrong", long after it was saved that way.
 */
class PhoneParseTest {

    @Test
    fun `splits a stored spanish number`() {
        assertEquals("+34" to "612345678", splitPhone("+34 612345678"))
    }

    @Test
    fun `tolerates spaces inside the number`() {
        assertEquals("+34" to "612345678", splitPhone("+34 612 345 678"))
    }

    /**
     * The overlap the longest-first sort exists for. "+35" is not a country, but
     * "+351" (Portugal) and "+34" (Spain) both prefix-match parts of each
     * other's numbers if the list is walked in declaration order.
     */
    @Test
    fun `prefers the longest matching dial code`() {
        assertEquals("+351" to "912345678", splitPhone("+351 912345678"))
        assertEquals("+34" to "912345678", splitPhone("+34 912345678"))
    }

    @Test
    fun `handles a one digit dial code`() {
        assertEquals("+1" to "4155551234", splitPhone("+1 415 555 1234"))
    }

    /**
     * Legacy rows predate the picker. Losing someone's number to a format change
     * would be worse than assuming the home market, so a bare number is kept.
     */
    @Test
    fun `keeps a bare national number against the default code`() {
        assertEquals("+34" to "612345678", splitPhone("612345678"))
    }

    @Test
    fun `empty input yields the default code and nothing else`() {
        assertEquals("+34" to "", splitPhone(""))
        assertEquals("+34" to "", splitPhone("   "))
    }

    @Test
    fun `strips formatting characters from the national part`() {
        assertEquals("+34" to "612345678", splitPhone("+34 (612) 345-678"))
    }

    /** An unknown code must not silently become part of the number's digits. */
    @Test
    fun `unknown dial code falls back rather than losing the digits`() {
        val (code, national) = splitPhone("+999 12345")
        assertEquals("+34", code)
        assertTrue("digits must survive", national.contains("12345"))
    }

    // ── The list itself ──────────────────────────────────────────────────────

    @Test
    fun `every dial code starts with a plus and is otherwise digits`() {
        COUNTRIES.forEach { country ->
            assertTrue(
                "${country.name} has a malformed dial code: ${country.dialCode}",
                country.dialCode.startsWith("+") &&
                    country.dialCode.drop(1).all { it.isDigit() },
            )
        }
    }

    @Test
    fun `every country caps at a plausible number length`() {
        COUNTRIES.forEach { country ->
            assertTrue(
                "${country.name} has an implausible digit cap: ${country.digits}",
                country.digits in 4..15,
            )
        }
    }

    @Test
    fun `the default dial code is one we actually carry`() {
        assertTrue(COUNTRIES.any { it.dialCode == DEFAULT_DIAL })
    }

    @Test
    fun `dial length ordering is strictly descending`() {
        val lengths = COUNTRIES_BY_DIAL_LENGTH.map { it.dialCode.length }
        assertEquals(lengths.sortedDescending(), lengths)
    }

    // ── Placeholder grouping ─────────────────────────────────────────────────

    @Test
    fun `placeholder groups digits in threes`() {
        assertEquals("612 345 678", placeholderFor(9))
    }

    /** A trailing single digit merges back rather than sitting alone. */
    @Test
    fun `placeholder merges a trailing single digit`() {
        assertEquals("612 345 6789", placeholderFor(10))
    }

    @Test
    fun `placeholder never exceeds twelve digits`() {
        assertTrue(placeholderFor(15).filter { it.isDigit() }.length <= 12)
    }
}
