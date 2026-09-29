package com.clubfuoco.app.features.bookings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Events the guest bookmarked but has NOT paid for, pinned above their real
 * tickets.
 *
 * These are not tickets and the section works hard not to look like one: no QR,
 * a dashed edge instead of a solid card, and the price stated as the thing left
 * to do rather than as a fact. Someone who mistakes a bookmark for entry finds
 * out at a door, which is the worst possible place to find out.
 *
 * Port of `SavedEventsSection`.
 */
@Composable
fun SavedEventsSection(
    api: ApiClient,
    /** Opens the invite so they can pay. */
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var events by remember { mutableStateOf<List<SavedEvent>>(emptyList()) }

    LaunchedEffect(Unit) {
        // Signed out is the common case here, not an error — stay silent.
        events = runCatching {
            withContext(Dispatchers.IO) {
                api.get("/api/me/saved-events", SavedEventsResponse.serializer())
            }
        }.getOrNull()?.events.orEmpty()
    }

    if (events.isEmpty()) return

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            stringResource(R.string.saved_notPaidYet).uppercase(),
            fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 2.sp,
            color = Theme.gold,
        )
        events.forEach { event -> SavedRow(event) { onOpen(event.inviteToken) } }
    }
}

@Composable
private fun SavedRow(event: SavedEvent, onClick: () -> Unit) {
    val dash = Theme.gold.copy(alpha = 0.35f)

    Box(Modifier.fillMaxWidth().clickableUnlessBusy(onClick = onClick)) {
        // Dashed, not solid: the edge is the first thing that says "this is not
        // a ticket", before any of the words do.
        Canvas(Modifier.matchParentSize()) {
            drawRoundRect(
                color = dash,
                size = Size(size.width, size.height),
                cornerRadius = CornerRadius(14.dp.toPx()),
                style = Stroke(
                    width = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(
                        floatArrayOf(5.dp.toPx(), 4.dp.toPx()),
                    ),
                ),
            )
        }

        Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    event.title ?: event.venueName,
                    fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 15.sp,
                    color = Theme.ink,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${event.venueName} · ${formatNight(event.nightDate)}",
                    fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            // Reads as the thing left to do, not as a label.
            Text(
                if (event.priceCents > 0) {
                    stringResource(R.string.saved_pay, event.priceLabel)
                } else {
                    stringResource(R.string.saved_join)
                },
                fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                color = Theme.cream,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Theme.accent)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}

@Serializable
private data class SavedEventsResponse(val events: List<SavedEvent> = emptyList())

@Serializable
data class SavedEvent(
    @SerialName("allocationId") val allocationId: String,
    @SerialName("inviteToken") val inviteToken: String,
    val title: String? = null,
    @SerialName("nightDate") val nightDate: String = "",
    @SerialName("venueName") val venueName: String = "",
    @SerialName("priceCents") val priceCents: Int = 0,
    val currency: String? = null,
) {
    val priceLabel: String
        get() {
            val symbol = if ((currency ?: "eur").lowercase() == "eur") "€" else ""
            return if (priceCents % 100 == 0) "$symbol${priceCents / 100}"
            else String.format(Locale.US, "%s%.2f", symbol, priceCents / 100.0)
        }
}

private fun formatNight(ymd: String): String = runCatching {
    LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault()))
}.getOrElse { ymd }
