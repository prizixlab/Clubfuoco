package com.clubfuoco.app.features.events

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.network.ApiException
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.models.FeaturedDJ
import com.clubfuoco.app.models.FeedEvent
import com.clubfuoco.app.models.LineupCredit
import com.clubfuoco.app.models.Place
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The event page's state and actions. Port of the logic half of
 * `EventDetailView`.
 *
 * Reserving writes an ordinary BOOKING, which is what makes the spot inherit
 * everything a paid booking already has: the door pass, the Tickets tab, the
 * arrival check-in, and the morning-after review. The server also puts the guest
 * on the night's door list, which is what the room's capacity counts against.
 */
class EventDetailViewModel : ViewModel() {

    /** The dock's five states. */
    enum class Dock { READY, WORKING, RESERVED, FULL, SIGNED_OUT }

    var reserved by mutableStateOf(false)
        private set
    var full by mutableStateOf(false)
        private set
    var working by mutableStateOf(false)
        private set
    var errorText by mutableStateOf<String?>(null)

    var bookingId by mutableStateOf<String?>(null)
        private set
    var scanToken by mutableStateOf<String?>(null)
        private set
    var reference by mutableStateOf<String?>(null)
        private set

    /** Checkout URL to hand to the browser, consumed once by the screen. */
    var checkoutUrl by mutableStateOf<String?>(null)

    /**
     * The line-up resolved against the DJ catalogue so a credit can open the
     * artist's page. Ids are exact; names are the fallback for legacy credits
     * that carry no id.
     */
    private var djById by mutableStateOf<Map<String, FeaturedDJ>>(emptyMap())
    private var djByName by mutableStateOf<Map<String, FeaturedDJ>>(emptyMap())

    /** Route stops resolved to real venues, keyed by lowercased club id. */
    var stopPlaces by mutableStateOf<Map<String, Place>>(emptyMap())
        private set

    private var loaded = false
    private val json = Json { encodeDefaults = true }

    fun dockState(hasAccount: Boolean): Dock = when {
        working -> Dock.WORKING
        !hasAccount -> Dock.SIGNED_OUT
        reserved -> Dock.RESERVED
        full -> Dock.FULL
        else -> Dock.READY
    }

    fun djFor(credit: LineupCredit): FeaturedDJ? =
        credit.id?.let { djById[it] } ?: djByName[credit.name]

    // ── Wire payloads ────────────────────────────────────────────────────────

    @Serializable
    private data class StateResult(
        val reserved: Boolean? = null,
        val full: Boolean? = null,
        @kotlinx.serialization.SerialName("bookingId") val bookingId: String? = null,
        @kotlinx.serialization.SerialName("scanToken") val scanToken: String? = null,
        val reference: String? = null,
    )

    @Serializable
    private data class CheckoutBody(
        @kotlinx.serialization.SerialName("full_name") val fullName: String,
        @kotlinx.serialization.SerialName("plus_ones") val plusOnes: Int,
    )

    @Serializable
    private data class CheckoutReply(
        val url: String? = null,
        @kotlinx.serialization.SerialName("alreadyPaid") val alreadyPaid: Boolean? = null,
    )

    // ── Loading ──────────────────────────────────────────────────────────────

    fun start(event: FeedEvent, api: ApiClient, queries: Queries) {
        if (loaded) return
        loaded = true
        viewModelScope.launch {
            loadState(event, api)
            loadDjs(event, queries)
            loadStops(event, queries)
        }
    }

    /** Public route, so this runs for guests too — they still get the capacity answer. */
    private suspend fun loadState(event: FeedEvent, api: ApiClient) {
        val result = runCatching {
            withContext(Dispatchers.IO) {
                api.get("/api/events/${event.id}/reserve", StateResult.serializer())
            }
        }.getOrNull() ?: return
        reserved = result.reserved == true
        full = result.full == true
        bookingId = result.bookingId
        scanToken = result.scanToken
        reference = result.reference
    }

    /**
     * Resolve the billed credits against the `djs` catalogue.
     *
     * Failure is silent: an unresolved credit is simply not tappable, and the
     * page still reads. Promising a page that does not exist is worse than a
     * plain name.
     */
    private suspend fun loadDjs(event: FeedEvent, queries: Queries) {
        val credits = event.credits
        if (credits.isEmpty()) return
        val ids = credits.mapNotNull { it.id }.distinct()
        val names = credits.filter { it.id == null }.map { it.name }.distinct()

        withContext(Dispatchers.IO) {
            val byId = async { queries.djsByIds(ids) }
            val byName = async { queries.djsByNames(names) }
            val idRows = byId.await()
            val nameRows = byName.await()
            djById = idRows.associateBy { it.raArtistId }
            djByName = nameRows.associateBy { it.name }
        }
    }

    /**
     * Resolve the route's venues so a stop can open that club's page. One
     * batched query, not one per stop; a failure leaves the rows untappable
     * rather than emptying the timeline.
     */
    private suspend fun loadStops(event: FeedEvent, queries: Queries) {
        val ids = event.route.mapNotNull { it.clubId }.distinct()
        if (ids.isEmpty()) return
        val places = runCatching {
            withContext(Dispatchers.IO) { queries.clubsByIds(ids) }
        }.getOrElse { emptyList() }
        stopPlaces = places.associateBy { it.placeId.lowercase() }
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    fun reserve(event: FeedEvent, api: ApiClient, failureText: String, onPass: () -> Unit) {
        working = true
        errorText = null
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    api.post("/api/events/${event.id}/reserve", StateResult.serializer())
                }
            }
            result.onSuccess {
                reserved = true
                bookingId = it.bookingId
                scanToken = it.scanToken
                reference = it.reference
                // Straight into the pass — the QR and the calendar, the same
                // things a paid booking offers on confirmation. Hunting for it
                // in Tickets afterwards would make a free list feel like less
                // than a paid one.
                if (it.bookingId != null) onPass()
            }.onFailure {
                errorText = (it as? ApiException.Http)?.message ?: failureText
            }
            working = false
        }
    }

    fun cancel(event: FeedEvent, api: ApiClient, failureText: String) {
        working = true
        errorText = null
        viewModelScope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) {
                    api.delete("/api/events/${event.id}/reserve", StateResult.serializer())
                }
            }.isSuccess
            if (ok) {
                reserved = false
                bookingId = null
                scanToken = null
                reference = null
                // A spot just reopened, so `full` may have changed too.
                loadState(event, api)
            } else {
                errorText = failureText
            }
            working = false
        }
    }

    /**
     * Start a purchase.
     *
     * Deliberately the SAME endpoint an invite link uses. That path already
     * holds the capacity check, the 15-minute hold, the payout verification and
     * the release stamping — a second implementation would drift from it, and
     * money is the worst place to keep two truths.
     */
    fun buy(event: FeedEvent, api: ApiClient, buyerName: String, failureText: String) {
        val token = event.inviteToken ?: return
        working = true
        errorText = null
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/promoter-invites/$token/checkout",
                        CheckoutReply.serializer(),
                        json.encodeToString(
                            CheckoutBody.serializer(),
                            CheckoutBody(buyerName, 0),
                        ),
                    )
                }
            }
            result.onSuccess { reply ->
                if (reply.alreadyPaid == true) {
                    loadState(event, api)
                } else if (!reply.url.isNullOrEmpty()) {
                    checkoutUrl = reply.url
                } else {
                    errorText = failureText
                }
            }.onFailure {
                // The server's message is the useful one here — it is what says
                // "this event can't take payments yet" when a promoter has not
                // finished their payout setup.
                errorText = (it as? ApiException.Http)?.message ?: failureText
            }
            working = false
        }
    }
}
