package com.clubfuoco.app.stores

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import java.util.Locale

/**
 * Port of ios-native's `LocaleStore`. Persists under the SAME key the web app
 * uses in localStorage and iOS uses in UserDefaults ("cf-locale"), so the three
 * clients describe the setting identically.
 *
 * Where iOS resolves strings itself — looking them up in the chosen .lproj
 * bundle and falling back to English — Android can do the same job with the
 * platform's own resource machinery: [LocalizedContent] hands the composition a
 * Context configured for the chosen locale, so plain `stringResource(...)`
 * resolves against values-es/ (etc.) and falls back to values/ automatically
 * when a key is missing. That keeps every call site free of a custom `t()`.
 */
class LocaleStore(private val context: Context) {

    enum class Setting(val tag: String) {
        EN("en"), ES("es"), CA("ca"), FR("fr"), DEVICE("device");

        companion object {
            fun from(raw: String?): Setting? = entries.firstOrNull { it.tag == raw }
        }
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var setting: Setting by mutableStateOf(
        // Default to English on a fresh install. The web app auto-detects the
        // device language, but the native apps ship English-first; users can
        // switch to device-language or a specific one in Settings.
        Setting.from(prefs.getString(STORAGE_KEY, null)) ?: Setting.EN,
    )
        private set

    /** The resolved BCP-47 tag actually used for lookups. */
    val locale: String
        get() = resolve(setting)

    fun set(value: Setting) {
        setting = value
        prefs.edit().putString(STORAGE_KEY, value.tag).apply()
    }

    /**
     * Mirrors iOS's `detectDeviceLocale()`: the first preferred language that is
     * Catalan, Spanish or French wins, in device order; otherwise English.
     * Order matters — a device listing Catalan above Spanish should get Catalan.
     */
    private fun resolve(setting: Setting): String {
        if (setting != Setting.DEVICE) return setting.tag
        val list = LocaleList.getDefault()
        for (i in 0 until list.size()) {
            when (list[i].language) {
                "ca" -> return "ca"
                "es" -> return "es"
                "fr" -> return "fr"
            }
        }
        return "en"
    }

    companion object {
        const val STORAGE_KEY = "cf-locale"
        private const val PREFS = "cf.settings"
    }
}

/**
 * Provides a locale-overridden Context (and matching Configuration) to the
 * subtree, so every `stringResource` inside honours the in-app language choice
 * rather than the system one.
 */
@Composable
fun LocalizedContent(tag: String, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current

    val localized = remember(tag, configuration) {
        val locale = Locale.forLanguageTag(tag)
        val config = Configuration(configuration).apply {
            setLocales(LocaleList(locale))
        }
        context.createConfigurationContext(config)
    }

    CompositionLocalProvider(
        LocalContext provides localized,
        LocalConfiguration provides localized.resources.configuration,
        content = content,
    )
}
