package com.clubfuoco.app.features.events

import android.content.Context
import android.content.Intent
import android.provider.CalendarContract
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.features.bookings.QrCode
import com.clubfuoco.app.models.FeedEvent
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * What comes up the moment a spot is reserved, and again on "view pass".
 *
 * Deliberately the same things a paid booking's manage section offers, in the
 * same order, because a reservation IS a booking: the door QR and the calendar.
 * Reserving and then having to hunt in Tickets for the pass would make a free
 * guest list feel less finished than a paid one.
 *
 * Port of `ReservedSheet`, minus the wallet button — the server issues Apple
 * `.pkpass` files, which Google Wallet cannot read (docs/TESTING.md B7).
 */
@Composable
fun ReservedSheet(
    event: FeedEvent,
    bookingId: String?,
    scanToken: String?,
    reference: String?,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val tonight = stringResource(R.string.plan_tonight)
    val tomorrow = stringResource(R.string.plan_tomorrow)

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 20.dp)
            .padding(top = 24.dp, bottom = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Filled.CheckCircle,
            contentDescription = null,
            tint = Theme.accent,
            modifier = Modifier.size(44.dp),
        )
        Text(
            stringResource(R.string.events_reserved),
            fontFamily = InstrumentSerif, fontSize = 28.sp, color = Theme.ink,
            modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            event.displayTitle,
            fontFamily = Geist, fontSize = 14.sp, color = Theme.stone,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            event.metaLine(tonight, tomorrow).uppercase(),
            fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 1.2.sp,
            color = Theme.fadedSand,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )

        // The pass, on a fixed white card in both appearances — a scanner needs
        // the quiet zone, so this one surface never follows the theme.
        if (scanToken != null) {
            Column(
                Modifier
                    .padding(top = 22.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(FuocoFixed.qrSurface)
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                QrCode(token = scanToken, modifier = Modifier.size(190.dp))
                Text(
                    stringResource(R.string.bookings_atDoor),
                    fontFamily = Geist, fontSize = 12.sp,
                    color = FuocoFixed.onQrSurface.copy(alpha = 0.7f),
                )
                reference?.let {
                    // The WHOLE reference. It is what door staff and support
                    // look a guest up by, so a truncated one is not a shorter
                    // label — it is the wrong code.
                    Text(
                        it.uppercase(),
                        fontFamily = GeistMono, fontSize = 11.sp, letterSpacing = 0.8.sp,
                        color = FuocoFixed.onQrSurface.copy(alpha = 0.55f),
                        textAlign = TextAlign.Center,
                    )
                }
            }
        } else {
            // No token means we cannot render a working pass. Say so rather than
            // showing a QR that will not scan at the door.
            Text(
                stringResource(R.string.events_passUnavailable),
                fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(vertical = 24.dp),
            )
        }

        Row(
            Modifier
                .padding(top = 18.dp)
                .fillMaxWidth()
                .height(50.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Theme.surface)
                .border(1.dp, Theme.hairline, RoundedCornerShape(14.dp))
                .clickableUnlessBusy { addToCalendar(context, event) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            Icon(
                Icons.Filled.CalendarMonth,
                contentDescription = null,
                tint = Theme.ink,
                modifier = Modifier.size(16.dp),
            )
            Text(
                stringResource(R.string.groups_addToCalendar),
                fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                color = Theme.ink,
            )
        }

        Box(Modifier.height(6.dp))

        Text(
            stringResource(R.string.common_done),
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
            color = Theme.stone,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 14.dp)
                .clickableUnlessBusy(onClick = onClose),
        )
    }
}

/**
 * Hands the night to whatever calendar app the phone uses, pre-filled.
 *
 * An INSERT intent rather than a direct write: the user sees the entry and taps
 * save themselves, which needs no calendar permission at all and never silently
 * puts anything in someone's diary. The manifest's WRITE_CALENDAR grant exists
 * for the iOS parity path and is not used here.
 */
private fun addToCalendar(context: Context, event: FeedEvent) {
    val zone = ZoneId.of("Europe/Madrid")
    val day = runCatching { LocalDate.parse(event.nightDate) }.getOrNull() ?: return

    // Bare clocks, and a close earlier than the open means the next morning.
    val open = event.openTime?.take(5)?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
        ?: LocalTime.of(23, 0)
    val close = event.closeTime?.take(5)?.let { runCatching { LocalTime.parse(it) }.getOrNull() }

    val start = day.atTime(open).atZone(zone).toInstant().toEpochMilli()
    val end = close
        ?.let { day.let { d -> if (it <= open) d.plusDays(1) else d }.atTime(it) }
        ?.atZone(zone)?.toInstant()?.toEpochMilli()
        ?: (start + 4 * 60 * 60 * 1000)

    val intent = Intent(Intent.ACTION_INSERT)
        .setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, event.displayTitle)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
        .putExtra(
            CalendarContract.Events.EVENT_LOCATION,
            event.address ?: event.placeLine.orEmpty(),
        )
        .putExtra(
            CalendarContract.Events.DESCRIPTION,
            context.getString(R.string.groups_calendarNotes),
        )

    // No calendar app installed is a real state on some devices; do nothing
    // rather than crash out of the pass the guest is holding.
    runCatching { context.startActivity(intent) }
}
