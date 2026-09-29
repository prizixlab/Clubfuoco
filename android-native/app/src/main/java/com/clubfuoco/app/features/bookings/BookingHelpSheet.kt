package com.clubfuoco.app.features.bookings

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.Booking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Guest-facing help for one reservation.
 *
 * Two jobs, in this order: give an answer the guest can act on NOW — most door
 * problems are solved in the queue, not by a reply hours later — and only then
 * file a report carrying the booking's context, so nobody has to repeat
 * themselves.
 *
 * That ordering is why the reference sits above the topic list rather than
 * behind the form: at a door, the code IS the fix.
 *
 * Port of `BookingHelpSheet`.
 */
private data class HelpTopic(
    val value: String,
    val titleRes: Int,
    val bodyRes: Int,
    val icon: ImageVector,
)

private val HELP_TOPICS = listOf(
    HelpTopic("refused", R.string.help_refused, R.string.help_refusedBody, Icons.Filled.PanTool),
    HelpTopic("qr", R.string.help_qr, R.string.help_qrBody, Icons.Filled.QrCodeScanner),
    HelpTopic("details", R.string.help_details, R.string.help_detailsBody, Icons.Filled.Edit),
    HelpTopic("charge", R.string.help_charge, R.string.help_chargeBody, Icons.Filled.CreditCard),
    HelpTopic("queue", R.string.help_queue, R.string.help_queueBody, Icons.Filled.AccessTime),
    HelpTopic("other", R.string.help_other, R.string.help_otherBody, Icons.Filled.MoreHoriz),
)

@Composable
fun BookingHelpSheet(booking: Booking, api: ApiClient, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()

    var selected by remember { mutableStateOf<HelpTopic?>(null) }
    var note by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .verticalScroll(rememberScrollState())
            .safeDrawingPadding()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.help_title),
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 28.sp, color = Theme.ink,
                modifier = Modifier.weight(1f),
            )
            Text(
                stringResource(R.string.common_close),
                fontFamily = Geist, fontSize = 14.sp, color = Theme.wine,
                modifier = Modifier.clickableUnlessBusy(onClick = onClose),
            )
        }

        if (sent) {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(
                    Icons.Filled.Verified, contentDescription = null,
                    tint = Theme.accent, modifier = Modifier.size(40.dp),
                )
                Text(
                    stringResource(R.string.help_sentTitle),
                    fontFamily = InstrumentSerif, fontSize = 26.sp, color = Theme.ink,
                )
                Text(
                    stringResource(R.string.help_sentBody),
                    fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
                    textAlign = TextAlign.Center,
                )
            }
            return@Column
        }

        Text(
            stringResource(R.string.help_subtitle),
            fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
        )

        // The fastest fix for a door problem is the reference itself, so it sits
        // ABOVE the report form rather than behind it.
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(Theme.accent.copy(alpha = 0.09f))
                .border(1.dp, Theme.accent.copy(alpha = 0.20f), RoundedCornerShape(14.dp))
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                stringResource(R.string.help_urgent).uppercase(),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 0.8.sp,
                color = Theme.accent,
            )
            Text(
                stringResource(R.string.help_urgentBody),
                fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
            )
            // The CF- reference, not the scan token. This is the label support
            // and door staff look a guest up by; the door secret never belongs
            // on a screen someone might photograph or read out.
            booking.qrCodeToken?.let { reference ->
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        stringResource(R.string.help_reference).uppercase(),
                        fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 0.8.sp,
                        color = Theme.accent.copy(alpha = 0.75f),
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        reference,
                        fontFamily = GeistMono, fontSize = 13.sp, color = Theme.ink,
                    )
                }
            }
        }

        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(Theme.surface),
        ) {
            HELP_TOPICS.forEachIndexed { index, topic ->
                val on = selected?.value == topic.value
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickableUnlessBusy { selected = topic }
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Icon(
                        topic.icon,
                        contentDescription = null,
                        tint = if (on) Theme.accent else Theme.stone,
                        modifier = Modifier.size(20.dp),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            stringResource(topic.titleRes),
                            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                            color = Theme.ink,
                        )
                        Text(
                            stringResource(topic.bodyRes),
                            fontFamily = Geist, fontSize = 11.sp, lineHeight = 16.sp,
                            color = Theme.stone,
                        )
                    }
                    Icon(
                        if (on) Icons.Filled.CheckCircle
                        else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = if (on) Theme.accent else Theme.sand,
                        modifier = Modifier.size(if (on) 18.dp else 14.dp),
                    )
                }
                if (index != HELP_TOPICS.lastIndex) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .padding(start = 52.dp)
                            .height(1.dp)
                            .background(Theme.hairline),
                    )
                }
            }
        }

        // The composer only appears once a topic is picked: a free-text box with
        // no category attached is what turns a support queue into guesswork.
        selected?.let { topic ->
            Column(
                Modifier.fillMaxWidth().animateContentSize(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    stringResource(R.string.help_describe),
                    fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                )

                Box(
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 90.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Theme.surface)
                        .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                ) {
                    if (note.isEmpty()) {
                        Text(
                            stringResource(R.string.help_notePlaceholder),
                            fontFamily = Geist, fontSize = 14.sp, color = Theme.fadedSand,
                        )
                    }
                    BasicTextField(
                        value = note,
                        onValueChange = { note = it },
                        textStyle = TextStyle(
                            fontFamily = Geist, fontSize = 14.sp, color = Theme.ink,
                        ),
                        cursorBrush = SolidColor(Theme.wine),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                if (failed) {
                    Text(
                        stringResource(R.string.help_failed),
                        fontFamily = Geist, fontSize = 12.sp, color = Theme.wine,
                    )
                }

                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Theme.wine.copy(alpha = if (sending) 0.6f else 1f))
                        .clickableUnlessBusy(enabled = !sending) {
                            sending = true
                            failed = false
                            scope.launch {
                                val ok = runCatching {
                                    withContext(Dispatchers.IO) {
                                        api.post(
                                            "/api/support",
                                            SupportResponse.serializer(),
                                            Json.encodeToString(
                                                SupportRequest.serializer(),
                                                SupportRequest(
                                                    topic = topic.value,
                                                    message = note,
                                                    bookingId = booking.id,
                                                ),
                                            ),
                                        )
                                    }
                                }.isSuccess
                                sending = false
                                if (ok) sent = true else failed = true
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        stringResource(if (sending) R.string.help_sending else R.string.help_send),
                        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                        color = Theme.cream,
                    )
                }
            }
        }

        Spacer(Modifier.height(20.dp))
    }
}

@Serializable
private data class SupportRequest(
    val topic: String,
    val message: String,
    val bookingId: String,
)

@Serializable
private data class SupportResponse(val id: String? = null)
