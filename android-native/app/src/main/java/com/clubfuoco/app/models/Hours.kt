package com.clubfuoco.app.models

import java.time.LocalDate
import java.time.LocalTime
import java.util.Calendar
import java.util.Locale

/**
 * Opening-hours helpers — port of src/lib/hours.ts and `Hours` in Place.swift.
 *
 * Nightlife hours cross midnight constantly ("Monday: 6:00 PM – 3:00 AM"), which
 * is the source of nearly every subtlety here. All three clients must agree on
 * this arithmetic or a venue shows as open on one and closed on another.
 */
object Hours {

    private val AM_PM = Regex("""^(\d{1,2}):?(\d{2})?\s*([AaPp][Mm])$""")

    /** "5:00 PM" / "18:00" → minutes from midnight, or null. */
    private fun parseClock(raw: String): Int? {
        val t = raw.trim()

        AM_PM.find(t)?.let { match ->
            val hour = match.groupValues[1].toIntOrNull() ?: return null
            val minute = match.groupValues[2].toIntOrNull() ?: 0
            val isPm = match.groupValues[3].uppercase(Locale.ROOT) == "PM"
            var h = hour
            if (isPm && h != 12) h += 12
            if (!isPm && h == 12) h = 0
            return h * 60 + minute
        }

        val parts = t.split(":")
        if (parts.size == 2) {
            val h = parts[0].trim().toIntOrNull()
            val m = parts[1].trim().toIntOrNull()
            if (h != null && m != null && h <= 24 && m < 60) return (h % 24) * 60 + m
        }
        return null
    }

    data class Range(val open: Int, val close: Int)

    /**
     * "Monday: 6:00 PM – 3:00 AM" → ranges in minutes. Handles multiple
     * comma-separated ranges ("5:30 – 11:30 PM, 11:59 PM – 6:00 AM"); empty when
     * closed or unparseable.
     */
    fun parseRanges(row: String?): List<Range> {
        if (row == null) return emptyList()
        val hrs = row.substringAfter(':', row).trim()
        if (hrs.contains("closed", ignoreCase = true)) return emptyList()

        return hrs.split(",").mapNotNull { segment ->
            val parts = segment
                .split('–', '—', '-')
                .flatMap { it.split(" to ") }
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            if (parts.size != 2) return@mapNotNull null
            val open = parseClock(parts[0]) ?: return@mapNotNull null
            val close = parseClock(parts[1]) ?: return@mapNotNull null
            Range(open, close)
        }
    }

    /** Monday=0 … Sunday=6, from a java.util Calendar weekday (Sunday=1). */
    private fun mondayIndex(calendarWeekday: Int): Int = (calendarWeekday + 5) % 7

    /**
     * Open right now, from the weekly hours (handles cross-midnight ranges).
     * null when hours are unknown. Port of `computeOpenNow()`.
     */
    fun computeOpenNow(rows: List<String>): Boolean? {
        if (rows.size < 7) return null
        val now = Calendar.getInstance()
        val nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val todayIdx = mondayIndex(now.get(Calendar.DAY_OF_WEEK))
        val yesterdayIdx = (todayIdx + 6) % 7

        for (range in parseRanges(rows[todayIdx])) {
            if (range.close >= range.open) {
                if (nowMin >= range.open && nowMin < range.close) return true
            } else if (nowMin >= range.open) {
                // Cross-midnight: open until close tomorrow.
                return true
            }
        }
        // Yesterday's range that wraps past midnight into today.
        for (range in parseRanges(rows[yesterdayIdx])) {
            if (range.close < range.open && nowMin < range.close) return true
        }
        return false
    }

    data class NightWindow(val openMin: Int, val closeMin: Int, val closesNextDay: Boolean)

    /**
     * Opening→closing window for the NIGHT of [date]. Falls back to 17:00 →
     * 03:00 when hours are unknown — these defaults bound the attendance
     * check-in window, so they must not be tightened casually.
     */
    fun nightWindow(date: String, hours: List<String>): NightWindow {
        val fallback = NightWindow(17 * 60, 3 * 60, closesNextDay = true)
        if (hours.size < 7) return fallback
        val day = runCatching { LocalDate.parse(date) }.getOrNull() ?: return fallback
        val idx = day.dayOfWeek.value - 1 // java.time: Monday=1 … Sunday=7
        val ranges = parseRanges(hours[idx])
        val chosen = ranges.firstOrNull {
            it.open >= 18 * 60 || it.close < it.open || it.close >= 22 * 60
        } ?: ranges.firstOrNull() ?: return fallback
        return NightWindow(chosen.open, chosen.close, closesNextDay = chosen.close < chosen.open)
    }

    /**
     * Open for the NIGHT of [date] ("yyyy-MM-dd"): evening hours, cross-midnight,
     * or closing at 22:00 or later. null when hours are unknown.
     *
     * This is what the explore feed filters on, so "open on the planned night"
     * means the venue is actually running that evening — not merely that some
     * daytime range exists.
     */
    fun isOpenOnDate(rows: List<String>, date: String): Boolean? {
        if (rows.size < 7) return null
        val day = runCatching { LocalDate.parse(date) }.getOrNull() ?: return null
        val idx = day.dayOfWeek.value - 1

        val ranges = parseRanges(rows[idx])
        if (ranges.isEmpty()) return false
        return ranges.any { range ->
            val opensEvening = range.open >= 18 * 60
            val crossesMidnight = range.close < range.open
            val closesLate = range.close >= 22 * 60
            opensEvening || crossesMidnight || closesLate
        }
    }

    /** Minutes from midnight for a LocalTime — used by the attendance window. */
    fun minutes(time: LocalTime): Int = time.hour * 60 + time.minute
}
