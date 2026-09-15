package com.clubfuoco.app.stores

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Port of ios-native's `ThemeStore`. Appearance is user-controlled in Settings —
 * Light / Dark / System — and defaults to Light, matching the iOS app rather
 * than the platform habit of defaulting to System.
 */
class ThemeStore(context: Context) {

    enum class Setting(val raw: String) {
        SYSTEM("system"), LIGHT("light"), DARK("dark");

        companion object {
            fun from(raw: String?): Setting? = entries.firstOrNull { it.raw == raw }
        }
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var setting: Setting by mutableStateOf(
        Setting.from(prefs.getString(STORAGE_KEY, null)) ?: Setting.LIGHT,
    )
        private set

    fun set(value: Setting) {
        setting = value
        prefs.edit().putString(STORAGE_KEY, value.raw).apply()
    }

    /** null = follow the system, the Compose analogue of a nil colorScheme. */
    fun isDark(systemDark: Boolean): Boolean = when (setting) {
        Setting.SYSTEM -> systemDark
        Setting.LIGHT -> false
        Setting.DARK -> true
    }

    companion object {
        const val STORAGE_KEY = "cf-theme"
        private const val PREFS = "cf.settings"
    }
}
