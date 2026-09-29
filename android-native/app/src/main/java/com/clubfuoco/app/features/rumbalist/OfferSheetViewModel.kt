package com.clubfuoco.app.features.rumbalist

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Minimal booking result for the Rumbalist endpoints. Both routes return
 * `select('*')`, so the door token comes back with the row — but only what the
 * pass actually needs is modelled.
 */
@Serializable
data class RumbalistBookingResult(
    val id: String,
    /** Public CF- reference — shown as the booking reference, never in a QR. */
    @SerialName("qr_code_token") val qrCodeToken: String? = null,
    /** The only token the door accepts. */
    @SerialName("scan_token") val scanToken: String? = null,
) {
    val doorToken: String? get() = scanToken
}

/**
 * Drives the offer sheet: joining a free guestlist, and (once Google Pay is
 * configured) paying for a VIP table.
 */
class OfferSheetViewModel : ViewModel() {

    var busy by mutableStateOf(false)
        private set
    var confirmation by mutableStateOf<RumbalistBookingResult?>(null)
        private set
    var errorMessage by mutableStateOf<String?>(null)

    private val json = Json { encodeDefaults = true }

    @Serializable
    private data class JoinBody(
        @SerialName("club_id") val clubId: String,
        @SerialName("venue_name") val venueName: String,
        @SerialName("product_name") val productName: String,
        @SerialName("booking_date") val bookingDate: String,
        @SerialName("plus_ones") val plusOnes: Int,
    )

    fun joinFree(
        clubId: String,
        venueName: String,
        bookingDate: String,
        plusOnes: Int,
        api: ApiClient,
    ) {
        busy = true
        errorMessage = null
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/rumbalist/join-guestlist",
                        RumbalistBookingResult.serializer(),
                        json.encodeToString(
                            JoinBody.serializer(),
                            JoinBody(
                                clubId = clubId,
                                venueName = venueName,
                                productName = "Free Guestlist",
                                bookingDate = bookingDate,
                                plusOnes = plusOnes,
                            ),
                        ),
                    )
                }
            }.onSuccess { confirmation = it }
                .onFailure { errorMessage = it.message ?: "Could not join" }
            busy = false
        }
    }
}
