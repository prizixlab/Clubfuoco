package com.clubfuoco.app.features.explore

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.cache.FeedCache
import com.clubfuoco.app.core.cache.FeedSnapshot
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.features.rumbalist.RumbalistOffer
import com.clubfuoco.app.features.rumbalist.RumbalistOffers
import com.clubfuoco.app.models.EventsPayload
import com.clubfuoco.app.models.ExternalEvent
import com.clubfuoco.app.models.FeedEvent
import com.clubfuoco.app.models.Hours
import com.clubfuoco.app.models.Place
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Drives the explore feed: nearby clubs via PostgREST, favourites, admin custom
 * shelves via the REST API, and the shelf-building pipeline. Port of
 * `ExploreViewModel.swift`.
 */
class ExploreViewModel : ViewModel() {

    sealed interface LoadState {
        data object Loading : LoadState
        data object Loaded : LoadState
        data class Failed(val message: String) : LoadState
    }

    var state: LoadState by mutableStateOf(LoadState.Loading)
        private set

    private val isLoaded: Boolean get() = state is LoadState.Loaded

    var places: List<Place> by mutableStateOf(emptyList())
        private set
    var saved: Set<String> by mutableStateOf(emptySet())
        private set

    /**
     * Built once per (places, filter, plan-date) change — NOT per render. The
     * shelf pool is shuffled, so rebuilding during composition would reshuffle
     * on every recomposition and restart every image load.
     */
    var shelves: List<Shelf> by mutableStateOf(emptyList())
        private set

    var search by mutableStateOf("")
    var showSearch by mutableStateOf(false)
    var showSaved by mutableStateOf(false)
    var activeFilter by mutableStateOf("all")

    private var customShelves: List<CustomShelfRecord> = emptyList()
    private var offersByClub: Map<String, List<RumbalistOffer>> = emptyMap()
    private var events: List<ExternalEvent> = emptyList()

    /**
     * OUR events — promoter nights and house nights, already gated and ordered
     * by the server (editorial pin, then paid promotion, then soonest). They sit
     * at the top of the feed rather than in a tab of their own. Empty on
     * failure: the venue feed must still render.
     */
    var feedEvents: List<FeedEvent> by mutableStateOf(emptyList())
        private set

    private var djClubIds: Set<String> = emptySet()
    private var userPrefs: UserPreferences? = null
    private var surveyPrefs: SurveyPreferences? = null
    private var tasteProfile: TasteProfile? = null

    private var queries: Queries? = null
    private var api: ApiClient? = null
    private var cache: FeedCache? = null

    private var didHydrate = false

    /**
     * Set once the first background refresh of this launch has started, so
     * returning to the tab doesn't re-fetch and reshuffle the feed the user was
     * just browsing.
     */
    var didRefresh = false

    fun configure(queries: Queries, api: ApiClient, cache: FeedCache) {
        this.queries = queries
        this.api = api
        this.cache = cache
    }

    /**
     * Paint the last-known feed from disk before the network is touched
     * (stale-while-revalidate). Reuses the *built* shelves so the render matches
     * the cached one exactly; only a changed planned night forces a rebuild.
     */
    fun hydrateFromCache(planDate: String, t: (String) -> String) {
        if (didHydrate) return
        didHydrate = true
        if (places.isNotEmpty()) return
        val snap = cache?.load() ?: return

        places = snap.places
        saved = snap.saved.toSet()
        if (snap.planDate == planDate) shelves = snap.shelves else rebuildShelves(planDate, t)
        state = LoadState.Loaded
    }

    /**
     * Loads the feed. The venue list is the only request the feed cannot render
     * without, so it is awaited first and painted immediately; the API-backed
     * extras then enrich a second build a beat later.
     */
    fun load(planDate: String, t: (String) -> String) {
        val queries = queries ?: return
        val api = api ?: return

        viewModelScope.launch {
            if (places.isEmpty()) state = LoadState.Loading

            val extras = listOf(
                async(Dispatchers.IO) { runCatching { queries.placeFavoriteIds() }.getOrElse { emptySet() } },
                async(Dispatchers.IO) { runCatching { api.get("/api/explore/shelves", ListSerializer(CustomShelfRecord.serializer())) }.getOrNull() },
                async(Dispatchers.IO) { RumbalistOffers.fetchLive(api) },
                async(Dispatchers.IO) { queries.upcomingEvents() },
                async(Dispatchers.IO) { queries.djClubIds() },
                async(Dispatchers.IO) { queries.userPreferences() },
                async(Dispatchers.IO) { runCatching { api.get("/api/surveys/preferences", SurveyPreferences.serializer()) }.getOrNull() },
                async(Dispatchers.IO) { queries.tasteProfile() },
                // Public route, so guests get these too.
                async(Dispatchers.IO) {
                    runCatching { api.get("/api/events/feed", EventsPayload.serializer()) }.getOrNull()
                },
            )

            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    queries.nearbyClubs(BARCELONA_LAT, BARCELONA_LNG, RADIUS_M)
                }
            }.getOrElse { error ->
                extras.forEach { it.cancel() }
                // Keep any cached/prior feed on screen; only surface the error
                // when there is genuinely nothing to show.
                if (!isLoaded) state = LoadState.Failed(error.message ?: "Could not load")
                return@launch
            }

            places = loaded.map { place ->
                place.copy(
                    distance = haversineKm(BARCELONA_LAT, BARCELONA_LNG, place.lat, place.lng),
                )
            }

            // First paint (cold start only). Base shelves rank without the deal
            // signal for a beat; the enriched build below folds offers in.
            if (!isLoaded) {
                rebuildShelves(planDate, t)
                state = LoadState.Loaded
            }

            val results = extras.awaitAll()
            @Suppress("UNCHECKED_CAST")
            saved = results[0] as Set<String>
            @Suppress("UNCHECKED_CAST")
            customShelves = (results[1] as List<CustomShelfRecord>?).orEmpty()
            @Suppress("UNCHECKED_CAST")
            offersByClub = (results[2] as Map<String, List<RumbalistOffer>>?).orEmpty()
            @Suppress("UNCHECKED_CAST")
            events = results[3] as List<ExternalEvent>
            @Suppress("UNCHECKED_CAST")
            djClubIds = results[4] as Set<String>
            userPrefs = results[5] as UserPreferences?
            surveyPrefs = results[6] as SurveyPreferences?
            tasteProfile = results[7] as TasteProfile?
            feedEvents = (results[8] as EventsPayload?)?.events.orEmpty()

            rebuildShelves(planDate, t)
            state = LoadState.Loaded

            cache?.save(
                FeedSnapshot(
                    places = places,
                    shelves = shelves,
                    saved = saved.toList(),
                    planDate = planDate,
                    savedAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    /**
     * Feed scoped to venues open on the planned night, the active chip, and
     * assembled into shelves.
     */
    fun rebuildShelves(planDate: String, t: (String) -> String) {
        val nightAll = places.filter { Hours.isOpenOnDate(it.weekdayHours, planDate) != false }
        val filtered = ShelfBuilder.filter(nightAll, activeFilter)
        shelves = ShelfBuilder.build(
            places = filtered,
            custom = customShelves,
            offersByClub = offersByClub,
            events = events,
            djClubIds = djClubIds,
            planDate = planDate,
            prefs = userPrefs,
            survey = surveyPrefs,
            taste = tasteProfile,
            t = t,
        )
    }

    val searchResults: List<Place>
        get() {
            val q = search.trim().lowercase()
            if (q.isEmpty()) return emptyList()
            return places.filter { place ->
                if (place.name.lowercase().contains(q)) return@filter true
                if (place.address.lowercase().contains(q)) return@filter true
                if (place.neighborhood?.lowercase()?.contains(q) == true) return@filter true
                // Genres + tags are snake_case ("live_music", "beach_club") —
                // match the raw value AND the spaced form.
                (place.musicGenres + place.tags).any { value ->
                    val v = value.lowercase()
                    v.contains(q) || v.replace("_", " ").contains(q)
                }
            }
        }

    val savedPlaces: List<Place> get() = places.filter { it.placeId in saved }

    /**
     * The one event promoted to the big card at the head of the featured box, in
     * place of the venue that would otherwise lead it.
     *
     * ONLY a pinned event takes that slot. Pinning is the portal's editorial
     * call — the difference between "highlight this" and "this is just on" — so
     * an unpinned event mixes in with the venues instead of displacing one.
     * Falling back to the soonest event would mean the feed always led with an
     * event whether or not anyone had chosen it.
     */
    val leadEvent: FeedEvent? get() = feedEvents.firstOrNull { it.pinned }

    /** Everything except whichever event is leading the shelf. */
    val mixedEvents: List<FeedEvent> get() = feedEvents.filter { it.id != leadEvent?.id }

    /**
     * Optimistic save/unsave. Returns false when the action needs an account
     * (guest gate).
     */
    fun toggleSave(place: Place, isSignedIn: Boolean): Boolean {
        val queries = queries ?: return false
        if (!isSignedIn) return false

        val wasSaved = place.placeId in saved
        saved = if (wasSaved) saved - place.placeId else saved + place.placeId

        viewModelScope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) {
                    if (wasSaved) queries.removePlaceFavorite(place.placeId)
                    else queries.savePlaceFavorite(place)
                }
            }.isSuccess
            if (!ok) {
                // Revert on failure.
                saved = if (wasSaved) saved + place.placeId else saved - place.placeId
            }
        }
        return true
    }

    companion object {
        // Geolocation is not wired up: the feed always queries Barcelona centre,
        // exactly like iOS. See the review notes — the location permission the
        // app asks for is currently unused by this screen.
        const val BARCELONA_LAT = 41.3851
        const val BARCELONA_LNG = 2.1734
        const val RADIUS_M = 8000.0

        fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val r = 6371.0
            val dLat = (lat2 - lat1) * Math.PI / 180
            val dLng = (lng2 - lng1) * Math.PI / 180
            val a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1 * Math.PI / 180) * cos(lat2 * Math.PI / 180) *
                sin(dLng / 2) * sin(dLng / 2)
            return r * 2 * atan2(sqrt(a), sqrt(1 - a))
        }

        fun formatDistance(km: Double): String =
            if (km < 1) "${(km * 1000).toInt()} m" else String.format("%.1f km", km)
    }
}
