package com.clubfuoco.app.features.booking

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.network.ApiException
import com.clubfuoco.app.models.PlaceDetail
import com.clubfuoco.app.stores.PlanStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Booking a night at a venue. Port of `BookNightViewModel`.
 *
 * TWO PATHS OUT OF THIS SCREEN, and only one of them can charge a card:
 *
 *  - PAY NOW needs a confirmed PaymentIntent, which means Google Pay, which is
 *    not configured on this build (docs/TESTING.md B6). The sheet says so
 *    rather than showing a button that always fails.
 *  - PLAN WITH FRIENDS creates a group night and works completely. General
 *    entry is a free guestlist pass settled at the door, so the organiser gets
 *    their QR immediately with no card involved at all.
 *
 * That asymmetry is why the group path is the primary action here, not the
 * consolation prize it is on iOS.
 */
class BookNightViewModel : ViewModel() {

    var bookingType by mutableStateOf("general")
    var date by mutableStateOf(PlanStore.today())
    /** Clamped in the setter so no caller can put an impossible party through. */
    var partySize: Int
        get() = partySizeState
        set(value) { partySizeState = value.coerceIn(1, 20) }

    private var partySizeState by mutableStateOf(1)

    var busy by mutableStateOf(false)
        private set
    var groupCode by mutableStateOf<String?>(null)
        private set
    var errorMessage by mutableStateOf<String?>(null)

    private var detail: PlaceDetail? = null
    private val json = Json { encodeDefaults = true }

    fun configure(detail: PlaceDetail, planDate: String) {
        if (this.detail != null) return
        this.detail = detail
        date = if (PlanStore.isValid(planDate)) planDate else PlanStore.today()
        // A venue with no general entry price but a VIP minimum only sells
        // tables, so default to the thing it actually offers.
        if ((detail.generalEntryPrice ?: 0.0) == 0.0 &&
            (detail.vipTableMinSpend ?: 0.0) > 0.0
        ) {
            bookingType = "vip"
        }
    }

    val sellsVip: Boolean get() = (detail?.vipTableMinSpend ?: 0.0) > 0.0

    val unitPrice: Double
        get() = if (bookingType == "vip") detail?.vipTableMinSpend ?: 0.0
        else detail?.generalEntryPrice ?: 0.0

    val subtotal: Double get() = unitPrice * partySize

    /** No membership tiers ship today, so this is always zero — see the review. */
    val discount: Double get() = 0.0

    val total: Double get() = subtotal - discount

    /**
     * A general-entry night that costs nothing is a free guestlist, and the
     * group path gives the organiser their pass immediately. Worth saying out
     * loud on the sheet, because "book" implies a charge that is not coming.
     */
    val isFreeEntry: Boolean get() = bookingType == "general" && unitPrice == 0.0

    // ── Group night ──────────────────────────────────────────────────────────

    @Serializable
    private data class GroupBody(
        @SerialName("clubId") val clubId: String,
        @SerialName("bookingType") val bookingType: String,
        @SerialName("bookingDate") val bookingDate: String,
        /**
         * General entry is a free guestlist pass paid at the door, so the
         * organiser owes nothing up front. A VIP table is a real charge settled
         * from the group screen.
         */
        @SerialName("organizerPays") val organizerPays: Boolean,
        val members: List<String> = emptyList(),
    )

    @Serializable
    private data class GroupResult(
        val id: String,
        @SerialName("inviteCode") val inviteCode: String,
    )

    fun createGroup(api: ApiClient, failureText: String) {
        val detail = detail ?: return
        if (busy || groupCode != null) return
        busy = true
        errorMessage = null

        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/groups",
                        GroupResult.serializer(),
                        json.encodeToString(
                            GroupBody.serializer(),
                            GroupBody(
                                clubId = detail.placeId,
                                bookingType = bookingType,
                                bookingDate = date,
                                organizerPays = bookingType == "vip",
                            ),
                        ),
                    )
                }
            }.onSuccess { groupCode = it.inviteCode }
                .onFailure {
                    errorMessage = (it as? ApiException.Http)?.message ?: failureText
                }
            busy = false
        }
    }
}
