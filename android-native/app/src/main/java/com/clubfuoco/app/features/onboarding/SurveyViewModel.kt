package com.clubfuoco.app.features.onboarding

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.R
import com.clubfuoco.app.core.DRINK_CATEGORIES
import com.clubfuoco.app.core.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The seven questions, in order. */
enum class SurveyStepKey { MUSIC, VIBES, DRINKS, NIGHTS, BUDGET, SQUAD, CROWD }

/**
 * One choice. [value] is what gets STORED and later matched against venue tags,
 * so it is a stable key; [labelRes] is what the person reads.
 *
 * Music is the exception — its value and label are the same English genre
 * string, shared with the review survey's genre list, so the two surveys write
 * comparable rows.
 */
data class SurveyOption(
    val value: String,
    val labelRes: Int? = null,
    val literal: String? = null,
    val subRes: Int? = null,
)

/**
 * The onboarding preferences survey. Port of the logic half of `SurveyView`.
 *
 * Answers feed `PersonalizationScore`, which is what makes the Explore feed
 * anything other than a list sorted by distance. Every step is skippable and
 * the save is best-effort: nobody is kept out of the app because a preferences
 * POST failed.
 */
class SurveyViewModel : ViewModel() {

    var stepIndex by mutableStateOf(0)
        private set
    var saving by mutableStateOf(false)
        private set

    val music = mutableListOf<String>().toMutableStateList()
    val vibes = mutableListOf<String>().toMutableStateList()
    val drinks = mutableListOf<String>().toMutableStateList()
    val nights = mutableListOf<String>().toMutableStateList()
    var budget by mutableStateOf(50)
    var squad by mutableStateOf("")
    var crowd by mutableStateOf("")

    /** Which drink card is open, and the half-typed text in each one. */
    var expandedCategory by mutableStateOf<String?>(null)
    val customDrinkInput = mutableStateMapOf<String, String>()

    /**
     * Custom drinks typed into a specific category during this session.
     *
     * Needed because the payload is a flat list: once "Espresso Martini, extra
     * hot" is in `drinks` there is nothing on it that says which card it came
     * from, so each card has to remember its own additions or they would jump to
     * "Other" the moment the screen recomposed.
     */
    val customAdditions = mutableStateMapOf<String, List<String>>()

    val step: SurveyStepKey get() = SurveyStepKey.entries[stepIndex]
    val isLast: Boolean get() = stepIndex == SurveyStepKey.entries.size - 1
    val isFirst: Boolean get() = stepIndex == 0

    // ── Selection ────────────────────────────────────────────────────────────

    fun isSelected(value: String): Boolean = when (step) {
        SurveyStepKey.MUSIC -> value in music
        SurveyStepKey.VIBES -> value in vibes
        SurveyStepKey.DRINKS -> value in drinks
        SurveyStepKey.NIGHTS -> value in nights
        SurveyStepKey.CROWD -> crowd == value
        else -> false
    }

    fun toggle(value: String) {
        when (step) {
            SurveyStepKey.MUSIC -> music.toggle(value)
            // Capped at three. A "vibe" that matches everything matches nothing,
            // so the cap is what keeps this answer worth scoring against.
            SurveyStepKey.VIBES -> if (value in vibes || vibes.size < VIBE_CAP) vibes.toggle(value)
            SurveyStepKey.DRINKS -> drinks.toggle(value)
            SurveyStepKey.NIGHTS -> nights.toggle(value)
            SurveyStepKey.CROWD -> crowd = value
            else -> Unit
        }
    }

    private fun MutableList<String>.toggle(value: String) {
        if (!remove(value)) add(value)
    }

    val canAdvance: Boolean
        get() = when (step) {
            SurveyStepKey.MUSIC -> music.isNotEmpty()
            SurveyStepKey.VIBES -> vibes.isNotEmpty()
            SurveyStepKey.DRINKS -> drinks.isNotEmpty()
            SurveyStepKey.NIGHTS -> nights.isNotEmpty()
            SurveyStepKey.BUDGET -> true
            SurveyStepKey.SQUAD -> squad.isNotEmpty()
            SurveyStepKey.CROWD -> crowd.isNotEmpty()
        }

    // ── Custom entries ───────────────────────────────────────────────────────

    /** Anything typed on the music step, shown as a chip alongside the presets. */
    val musicWithCustom: List<SurveyOption>
        get() = MUSIC_OPTIONS + music
            .filterNot { value -> MUSIC_OPTIONS.any { it.value == value } }
            .map { SurveyOption(value = it, literal = it) }

    val vibesWithCustom: List<SurveyOption>
        get() = VIBE_OPTIONS + vibes
            .filterNot { value -> VIBE_OPTIONS.any { it.value == value } }
            .map { SurveyOption(value = it, literal = it) }

    fun addCustomMusic(raw: String) {
        val value = raw.trim()
        if (value.isEmpty() || value in music) return
        music.add(value)
    }

    fun addCustomVibe(raw: String) {
        val value = raw.trim()
        if (value.isEmpty() || value in vibes || vibes.size >= VIBE_CAP) return
        vibes.add(value)
    }

    // ── Drinks ───────────────────────────────────────────────────────────────

    fun toggleCategory(key: String) {
        expandedCategory = if (expandedCategory == key) null else key
    }

    /** "Other" holds anything that is not a preset item or a category key. */
    fun customItemsFor(categoryKey: String): List<String> =
        if (categoryKey == "other") drinks.filterNot { it in PRESET_DRINK_VALUES }
        else customAdditions[categoryKey].orEmpty()

    fun addCustomDrink(categoryKey: String) {
        val value = customDrinkInput[categoryKey].orEmpty().trim()
        customDrinkInput[categoryKey] = ""
        if (value.isEmpty() || value in drinks) return
        drinks.add(value)
        if (categoryKey != "other") {
            customAdditions[categoryKey] = customAdditions[categoryKey].orEmpty() + value
        }
    }

    /**
     * "I don't really care" — stores the CATEGORY key instead of any item.
     *
     * That distinction matters downstream: "beer" means any beer will do, while
     * an empty beer category means they simply didn't answer. Scoring treats
     * those very differently, so selecting it clears the individual picks.
     */
    fun setDontCare(categoryKey: String) {
        val category = DRINK_CATEGORIES.first { it.key == categoryKey }
        drinks.removeAll { it in category.items || it == categoryKey }
        drinks.add(categoryKey)
    }

    fun isDontCare(categoryKey: String): Boolean = categoryKey in drinks

    fun selectedCountFor(categoryKey: String): Int =
        if (categoryKey == "other") {
            customItemsFor(categoryKey).size
        } else {
            val category = DRINK_CATEGORIES.first { it.key == categoryKey }
            category.items.count { it in drinks } +
                customAdditions[categoryKey].orEmpty().count { it in drinks }
        }

    fun hasSelection(categoryKey: String): Boolean =
        selectedCountFor(categoryKey) > 0 || isDontCare(categoryKey)

    // ── Navigation ───────────────────────────────────────────────────────────

    fun back() {
        if (stepIndex > 0) stepIndex -= 1
    }

    fun advance(api: ApiClient, onComplete: () -> Unit) {
        if (!isLast) {
            stepIndex += 1
            return
        }
        finish(api, onComplete)
    }

    @Serializable
    private data class Preferences(
        val music: List<String>,
        val vibes: List<String>,
        val drinks: List<String>,
        val nights: List<String>,
        val budget: Int,
        val squad: String,
        val crowd: String,
    )

    @Serializable
    private data class SavedResponse(val saved: Boolean? = null)

    /**
     * Best-effort save. A failure here is silent on purpose: the answers are a
     * nice-to-have for ranking, and blocking someone out of the app they just
     * signed up for over a preferences POST would be absurd.
     */
    private fun finish(api: ApiClient, onComplete: () -> Unit) {
        if (saving) return
        saving = true
        val payload = Preferences(
            music = music.toList(),
            vibes = vibes.toList(),
            drinks = drinks.toList(),
            nights = nights.toList(),
            budget = budget,
            squad = squad,
            crowd = crowd,
        )
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/preferences",
                        SavedResponse.serializer(),
                        Json.encodeToString(Preferences.serializer(), payload),
                    )
                }
            }
            saving = false
            onComplete()
        }
    }

    companion object {
        const val VIBE_CAP = 3

        /** The slider's top end. Above it the answer is "no limit", not a number. */
        const val BUDGET_MAX = 250
        const val BUDGET_NO_LIMIT = 999
        val BUDGET_PRESETS = listOf(20, 50, 100, 150, 200)

        /**
         * Shared verbatim with the review survey's genre list — the two have to
         * agree or a user's stated taste never matches their reported nights.
         */
        val MUSIC_OPTIONS: List<SurveyOption> =
            com.clubfuoco.app.core.MUSIC_GENRES.map { SurveyOption(value = it, literal = it) }

        val VIBE_OPTIONS = listOf(
            SurveyOption("wild", R.string.survey_vibeWild),
            SurveyOption("intimate", R.string.survey_vibeIntimate),
            SurveyOption("underground", R.string.survey_vibeUnderground),
            SurveyOption("upscale", R.string.survey_vibeUpscale),
            SurveyOption("rooftop", R.string.survey_vibeRooftop),
            SurveyOption("beach", R.string.survey_vibeBeach),
            SurveyOption("dancing", R.string.survey_vibeDancing),
            SurveyOption("chill", R.string.survey_vibeChill),
        )

        val NIGHT_OPTIONS = listOf(
            SurveyOption("thursday", R.string.survey_nightThursday),
            SurveyOption("friday", R.string.survey_nightFriday),
            SurveyOption("saturday", R.string.survey_nightSaturday),
            SurveyOption("sunday", R.string.survey_nightSunday),
            SurveyOption("wednesday", R.string.survey_nightWednesday),
            SurveyOption("monday", R.string.survey_nightMonday),
            SurveyOption("tuesday", R.string.survey_nightTuesday),
            SurveyOption("special", R.string.survey_nightSpecial),
        )

        val CROWD_OPTIONS = listOf(
            SurveyOption("mixed", R.string.survey_crowdMixed),
            SurveyOption("lgbtq", R.string.survey_crowdLgbtq),
            SurveyOption("local", R.string.survey_crowdLocal),
            SurveyOption("international", R.string.survey_crowdInternational),
            SurveyOption("mature", R.string.survey_crowdMature),
            SurveyOption("young", R.string.survey_crowdYoung),
            SurveyOption("students", R.string.survey_crowdStudents),
            SurveyOption("industry", R.string.survey_crowdIndustry),
            SurveyOption("tourists", R.string.survey_crowdTourists),
            SurveyOption("wealthy", R.string.survey_crowdBottle),
        )

        val SQUAD_OPTIONS = listOf(
            SurveyOption("solo", R.string.survey_squadSolo, subRes = R.string.survey_squadSoloSub),
            SurveyOption("duo", R.string.survey_squadDuo, subRes = R.string.survey_squadDuoSub),
            SurveyOption("small", R.string.survey_squadCrew, subRes = R.string.survey_squadCrewSub),
            SurveyOption("large", R.string.survey_squadGang, subRes = R.string.survey_squadGangSub),
        )

        /** Every preset drink item AND every category key. */
        private val PRESET_DRINK_VALUES: Set<String> =
            DRINK_CATEGORIES.flatMap { it.items + it.key }.toSet()
    }
}
