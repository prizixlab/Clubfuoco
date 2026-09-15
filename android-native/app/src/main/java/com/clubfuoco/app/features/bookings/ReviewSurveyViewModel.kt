package com.clubfuoco.app.features.bookings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.DRINK_CATEGORIES
import com.clubfuoco.app.core.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The steps, in order. The pre-gate is a step so the progress bar is honest. */
enum class ReviewPhase { DID_YOU_GO, RATING, DRINKS, DRINK_RATINGS, MUSIC, CROWD, WOULD_RETURN }

/**
 * The morning-after review. Port of the logic half of `ReviewSurveySheet`.
 *
 * Two ways out, both of which end the booking's pending state:
 *  - "I didn't go" posts a `did_not_go` issue and stops. No further questions —
 *    asking someone to rate a night they never had is how you teach them to
 *    ignore the prompt.
 *  - The full five steps POST `/api/surveys`.
 */
class ReviewSurveyViewModel : ViewModel() {

    var phase by mutableStateOf(ReviewPhase.DID_YOU_GO)
        private set

    var rating by mutableStateOf(0)
    var musicRating by mutableStateOf(0)
    var crowdRating by mutableStateOf(0)

    /** "yes" | "maybe" | "no" */
    var wouldReturn by mutableStateOf<String?>(null)

    val musicGenres = mutableStateMapOf<String, Boolean>()

    /** Per-category preset picks, e.g. cocktails → {Negroni, Mojito}. */
    val drinkPicks = mutableStateMapOf<String, Set<String>>()

    /** Per-category free text, e.g. "their house signature". */
    val drinkCustom = mutableStateMapOf<String, String>()

    /** 1–5 stars per individual drink, filled in on the ratings step. */
    val drinkRatings = mutableStateMapOf<String, Int>()

    /** Which accordion card is open. Only one at a time. */
    var expandedCategory by mutableStateOf<String?>(null)

    var submitting by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set

    private val json = Json { encodeDefaults = true }

    // ── Derived ──────────────────────────────────────────────────────────────

    /** Every drink picked across every category — preset chips plus free text. */
    val allDrinks: List<String>
        get() = DRINK_CATEGORIES.flatMap { category ->
            val picks = drinkPicks[category.key].orEmpty().sorted()
            val extra = drinkCustom[category.key].orEmpty().trim()
            if (extra.isEmpty()) picks else picks + extra
        }

    /** Categories with at least one pick — what the API stores in `drinks`. */
    val selectedCategories: List<String>
        get() = DRINK_CATEGORIES
            .filter { countFor(it.key) > 0 }
            .map { it.key }

    fun countFor(key: String): Int =
        drinkPicks[key].orEmpty().size + if (drinkCustom[key].orEmpty().isBlank()) 0 else 1

    val selectedGenres: List<String> get() = musicGenres.filterValues { it }.keys.toList()

    val canAdvance: Boolean
        get() = when (phase) {
            ReviewPhase.DID_YOU_GO -> true
            ReviewPhase.RATING -> rating > 0
            ReviewPhase.DRINKS -> selectedCategories.isNotEmpty()
            ReviewPhase.DRINK_RATINGS -> allDrinks.all { (drinkRatings[it] ?: 0) > 0 }
            ReviewPhase.MUSIC -> musicRating > 0 && selectedGenres.isNotEmpty()
            ReviewPhase.CROWD -> crowdRating > 0
            ReviewPhase.WOULD_RETURN -> wouldReturn != null
        }

    val isLastPhase: Boolean get() = phase == ReviewPhase.WOULD_RETURN

    // ── Editing ──────────────────────────────────────────────────────────────

    fun advance() {
        val next = ReviewPhase.entries.getOrNull(phase.ordinal + 1) ?: return
        phase = next
    }

    fun toggleGenre(genre: String) {
        musicGenres[genre] = musicGenres[genre] != true
    }

    fun togglePick(categoryKey: String, item: String) {
        val current = drinkPicks[categoryKey].orEmpty()
        drinkPicks[categoryKey] = if (item in current) current - item else current + item
    }

    fun setCustom(categoryKey: String, text: String) {
        drinkCustom[categoryKey] = text
    }

    fun toggleCategory(key: String) {
        expandedCategory = if (expandedCategory == key) null else key
    }

    /** Tapping the same star again clears it, so a misfire is recoverable. */
    fun setDrinkRating(drink: String, stars: Int) {
        drinkRatings[drink] = if (drinkRatings[drink] == stars) 0 else stars
    }

    // ── Wire payloads ────────────────────────────────────────────────────────

    @Serializable
    private data class SignalBody(val kind: String, val reason: String? = null)

    @Serializable
    private data class SignalResponse(
        @kotlinx.serialization.SerialName("attendanceStatus")
        val attendanceStatus: String? = null,
        val logged: String? = null,
    )

    @Serializable
    private data class SurveyPayload(
        val bookingId: String,
        val rating: Int,
        /** The category keys, not the individual drinks. */
        val drinks: List<String>,
        /** `drink_kinds`: the specific drinks picked, per category. */
        val drinkKinds: Map<String, List<String>>,
        /** `drink_custom`: free-text additions, per category. */
        val drinkCustom: Map<String, String>,
        /** `drink_ratings`: 1–5 stars per individual drink. */
        val drinkRatings: Map<String, Int>,
        val vibeRating: Int,
        val crowdRating: Int,
        val wouldReturn: String,
        val musicGenres: List<String>,
    )

    @Serializable
    private data class SavedResponse(val saved: Boolean? = null)

    // ── Submitting ───────────────────────────────────────────────────────────

    /**
     * Record "I got in" the moment they say so, rather than waiting for the end
     * of the review. Somebody who answers the first question and then puts the
     * phone down has still told us they were there.
     *
     * Fire-and-forget: a failure just leaves attendance to the geofence signals.
     */
    fun recordWentIn(bookingId: String, api: ApiClient) {
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/bookings/$bookingId/signals",
                        SignalResponse.serializer(),
                        json.encodeToString(
                            SignalBody.serializer(),
                            SignalBody("post_entry_got_in"),
                        ),
                    )
                }
            }
        }
    }

    fun sendDidNotGo(bookingId: String, api: ApiClient, onDone: () -> Unit) {
        if (submitting) return
        submitting = true
        failed = false
        viewModelScope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/bookings/$bookingId/signals",
                        SignalResponse.serializer(),
                        json.encodeToString(
                            SignalBody.serializer(),
                            SignalBody("post_entry_issue", "did_not_go"),
                        ),
                    )
                }
            }.isSuccess
            submitting = false
            if (ok) onDone() else failed = true
        }
    }

    fun submit(bookingId: String, api: ApiClient, onDone: () -> Unit) {
        val answer = wouldReturn
        if (submitting || answer == null || !canAdvance) return
        submitting = true
        failed = false

        val drinks = allDrinks
        val payload = SurveyPayload(
            bookingId = bookingId,
            rating = rating,
            drinks = selectedCategories,
            drinkKinds = drinkPicks
                .filterValues { it.isNotEmpty() }
                .mapValues { (_, v) -> v.sorted() },
            drinkCustom = drinkCustom
                .mapValues { (_, v) -> v.trim() }
                .filterValues { it.isNotEmpty() },
            drinkRatings = drinkRatings.filter { it.key in drinks && it.value > 0 },
            vibeRating = musicRating,
            crowdRating = crowdRating,
            wouldReturn = answer,
            musicGenres = selectedGenres,
        )

        viewModelScope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/surveys",
                        SavedResponse.serializer(),
                        json.encodeToString(SurveyPayload.serializer(), payload),
                    )
                }
            }.isSuccess

            if (ok) {
                // A finished review is itself proof they got in, so attendance
                // picks it up. Best-effort: an older booking outside the
                // post-entry window has its signal rejected, and that is fine —
                // the survey row was already saved.
                runCatching {
                    withContext(Dispatchers.IO) {
                        api.post(
                            "/api/bookings/$bookingId/signals",
                            SignalResponse.serializer(),
                            json.encodeToString(
                                SignalBody.serializer(),
                                SignalBody("post_entry_got_in"),
                            ),
                        )
                    }
                }
            }

            submitting = false
            if (ok) onDone() else failed = true
        }
    }
}
