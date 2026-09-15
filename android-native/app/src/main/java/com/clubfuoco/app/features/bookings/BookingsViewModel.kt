package com.clubfuoco.app.features.bookings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.models.Booking
import com.clubfuoco.app.models.GuestSignup
import com.clubfuoco.app.models.TicketOrder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.time.LocalDate

/**
 * Drives the Tickets tab: bookings, guest-list signups and ticket orders split
 * into tonight / upcoming / past. Port of the model behind `BookingsView`.
 */
class BookingsViewModel : ViewModel() {

    sealed interface LoadState {
        data object Loading : LoadState
        data object Loaded : LoadState
        data class Failed(val message: String) : LoadState
    }

    var state: LoadState by mutableStateOf(LoadState.Loading)
        private set

    var bookings: List<Booking> by mutableStateOf(emptyList())
        private set
    var signups: List<GuestSignup> by mutableStateOf(emptyList())
        private set
    var tickets: List<TicketOrder> by mutableStateOf(emptyList())
        private set
    var showPast by mutableStateOf(false)

    /** Any dated entry the list can show, normalised so the sections can mix them. */
    sealed interface Item {
        val date: String
        data class Reservation(val booking: Booking) : Item {
            override val date get() = booking.bookingDate
        }
        data class Signup(val signup: GuestSignup) : Item {
            override val date get() = signup.guestList?.eventDate?.take(10).orEmpty()
        }
        data class Ticket(val order: TicketOrder) : Item {
            override val date get() = order.eventDate?.take(10).orEmpty()
        }
    }

    private val allItems: List<Item>
        get() = bookings.map { Item.Reservation(it) } +
            signups.map { Item.Signup(it) } +
            tickets.map { Item.Ticket(it) }

    private val today: String get() = LocalDate.now().toString()

    val tonight: List<Item> get() = allItems.filter { it.date == today }
    val upcoming: List<Item> get() = allItems.filter { it.date > today }.sortedBy { it.date }
    val past: List<Item> get() = allItems.filter { it.date.isNotEmpty() && it.date < today }
        .sortedByDescending { it.date }
    val hasPast: Boolean get() = past.isNotEmpty()

    // ── Pending reviews ──────────────────────────────────────────────────────

    /**
     * Bookings we have just reviewed or dismissed in THIS session.
     *
     * Filtering on this is what makes the card vanish the instant you finish,
     * instead of lingering until the next fetch reflects the new attendance
     * status — which on a slow connection is long enough to make people tap it
     * again.
     */
    private var dismissedReviewIds: Set<String> by mutableStateOf(emptySet())

    fun markReviewSubmitted(bookingId: String) {
        dismissedReviewIds = dismissedReviewIds + bookingId
    }

    /**
     * Swipe-away on a pending review. Drops the card immediately and persists
     * the dismissal (`bookings.survey_dismissed_at`) so it does not come back
     * on the next launch.
     */
    fun dismissReview(bookingId: String, api: ApiClient) {
        dismissedReviewIds = dismissedReviewIds + bookingId
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.delete(
                        "/api/surveys?booking_id=$bookingId",
                        DismissResponse.serializer(),
                    )
                }
            }
        }
    }

    @Serializable
    private data class DismissResponse(val dismissed: String? = null)

    /**
     * Nights from yesterday back to a week ago whose attendance is still
     * unresolved — the same window `/api/surveys` uses on the web.
     *
     * The lower bound matters as much as the upper one: asking someone about a
     * night three weeks ago gets a guess, not a memory, and a guess poisons the
     * per-club drink rankings the survey exists to build.
     */
    val pendingReviews: List<Booking>
        get() {
            val yesterday = LocalDate.now().minusDays(1).toString()
            val weekAgo = LocalDate.now().minusDays(7).toString()
            return bookings
                .filter { it.status != "cancelled" }
                .filter { it.attendanceStatus.orEmpty() !in RESOLVED_ATTENDANCE }
                .filter { it.id !in dismissedReviewIds }
                .filter { it.bookingDate in weekAgo..yesterday }
                .sortedByDescending { it.bookingDate }
        }

    fun load(queries: Queries) {
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) { queries.myBookings() }
            }
            result.onSuccess { data ->
                bookings = data.bookings
                signups = data.guestSignups
                tickets = data.ticketOrders
                state = LoadState.Loaded
            }.onFailure {
                // Only surface the error when there is nothing already on
                // screen — a refresh failure should not blank the list.
                if (state !is LoadState.Loaded) {
                    state = LoadState.Failed(it.message ?: "Could not load")
                }
            }
        }
    }

    private companion object {
        /**
         * Attendance states that already have an answer, one way or the other.
         * A booking in any of these has nothing left to ask about.
         */
        val RESOLVED_ATTENDANCE = setOf(
            "verified_attended",
            "likely_attended",
            "user_claimed_attended",
            "no_show",
            "disputed",
        )
    }
}
