package com.clubfuoco.app.stores

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * The "when are you going out" date set on Explore and read by the booking
 * flows. Port of `PlanStore.swift` / PlanContext.
 *
 * Persisted under the web app's key ("cf-plan"); stale (past) dates fall back to
 * today, and the window is capped at 14 days ahead like the planner and the
 * server guard.
 */
class PlanStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var date: String by mutableStateOf(
        prefs.getString(STORAGE_KEY, null)?.takeIf { isValid(it) } ?: today(),
    )
        private set

    fun set(value: String) {
        if (!isValid(value)) return
        date = value
        prefs.edit().putString(STORAGE_KEY, value).apply()
    }

    data class DayOption(val value: String, val label: String)

    /** today → +14 days with localised labels. */
    fun dayOptions(locale: Locale, tonight: String, tomorrow: String): List<DayOption> {
        val start = LocalDate.now()
        val fmt = DateTimeFormatter.ofPattern("EEE d MMM", locale)
        return (0..MAX_DAYS_AHEAD).map { offset ->
            val day = start.plusDays(offset.toLong())
            val text = when (offset) {
                0 -> tonight
                1 -> tomorrow
                else -> day.format(fmt)
            }
            DayOption(day.toString(), text)
        }
    }

    /**
     * A natural-language phrase for headlines that read "<phrase> with Rumba":
     * "Tonight" / "Tomorrow" / "Saturday" / "Next Saturday".
     */
    fun nightPhrase(locale: Locale, tonight: String, tomorrow: String, next: String): String {
        val picked = runCatching { LocalDate.parse(date) }.getOrNull() ?: return tonight
        val offset = ChronoUnit.DAYS.between(LocalDate.now(), picked)
        return when {
            offset < 1 -> tonight
            offset == 1L -> tomorrow
            else -> {
                var name = picked.dayOfWeek.getDisplayName(TextStyle.FULL, locale)
                if (offset >= 7) name = "$next $name"
                name.replaceFirstChar { it.uppercase() }
            }
        }
    }

    companion object {
        const val STORAGE_KEY = "cf-plan"
        const val MAX_DAYS_AHEAD = 14
        private const val PREFS = "cf.settings"

        fun today(): String = LocalDate.now().toString()

        /** today through 14 days ahead. */
        fun isValid(value: String): Boolean {
            val picked = runCatching { LocalDate.parse(value) }.getOrNull() ?: return false
            val days = ChronoUnit.DAYS.between(LocalDate.now(), picked)
            return days in 0..MAX_DAYS_AHEAD.toLong()
        }
    }
}
