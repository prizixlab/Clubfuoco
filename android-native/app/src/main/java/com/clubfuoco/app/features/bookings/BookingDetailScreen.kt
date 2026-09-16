package com.clubfuoco.app.features.bookings

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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.Booking
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * One reservation, full screen — opened by tapping a ticket on the Tickets tab.
 *
 * The QR is the point of this screen, so it sits above the fold on a card that
 * overlaps the hero. Then the facts strip, the check-in card, the receipt, the
 * venue and the manage actions.
 *
 * Port of `BookingDetailView`, minus the wallet button (docs/TESTING.md B7).
 */
@Composable
fun BookingDetailScreen(
    booking: Booking,
    api: ApiClient,
    canCancel: Boolean,
    onOpenGroup: (() -> Unit)? = null,
    onConfirmCancel: () -> Unit,
    onAttendanceChanged: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val cancelled = booking.status == "cancelled"
    var confirmingCancel by remember { mutableStateOf(false) }
    var showHelp by remember { mutableStateOf(false) }

    if (showHelp) {
        BookingHelpSheet(booking, api) { showHelp = false }
        return
    }

    // Passive confidence, no prompt: only ever piggy-backs on a grant the user
    // already gave, so opening a pass costs nothing and asks nothing.
    LaunchedEffect(booking.id) {
        if (!cancelled) firePassViewed(context, booking, api)
    }

    BackHandler(onBack = onBack)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .verticalScroll(rememberScrollState()),
    ) {
        Hero(booking, onBack) { showHelp = true }

        Column(
            Modifier
                .fillMaxWidth()
                // Lifts the QR card over the hero's lower edge.
                .offset(y = if (cancelled) 0.dp else (-46).dp)
                .padding(horizontal = 20.dp)
                .padding(top = if (cancelled) 24.dp else 0.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            val token = booking.doorToken
            if (!cancelled && token != null) QrCard(token)

            StatsStrip(booking)

            if (!cancelled) {
                AttendanceCheckInCard(booking, api, onAttendanceChanged)
            }

            Receipt(booking)
            WhereSection(booking)

            onOpenGroup?.let { open ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Theme.surface)
                        .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                        .clickableUnlessBusy(onClick = open)
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        Icons.Filled.Group, contentDescription = null,
                        tint = Theme.ink, modifier = Modifier.size(15.dp),
                    )
                    Text(
                        stringResource(R.string.bookings_seeWhosGoing),
                        fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                        color = Theme.ink,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = Theme.fadedSand,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }

            Section(stringResource(R.string.bookings_manage)) {
                Column(
                    Modifier.padding(top = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (!cancelled) {
                        ManageButton(
                            Icons.Filled.CalendarMonth,
                            stringResource(R.string.groups_addToCalendar),
                        ) { addBookingToCalendar(context, booking) }

                        ManageButton(
                            Icons.Filled.Share,
                            stringResource(R.string.bookings_shareTicket),
                        ) { shareBooking(context, booking) }
                    }

                    if (canCancel) {
                        if (confirmingCancel) {
                            Text(
                                stringResource(R.string.bookings_cancelQuestion),
                                fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                OutlinedAction(
                                    stringResource(R.string.bookings_keep),
                                    Theme.ink,
                                    Modifier.weight(1f),
                                ) { confirmingCancel = false }
                                OutlinedAction(
                                    stringResource(R.string.bookings_cancelBooking),
                                    Theme.wine,
                                    Modifier.weight(1f),
                                ) {
                                    confirmingCancel = false
                                    onConfirmCancel()
                                }
                            }
                        } else {
                            OutlinedAction(
                                stringResource(R.string.common_cancel),
                                Theme.wine,
                                Modifier.fillMaxWidth(),
                            ) { confirmingCancel = true }
                        }
                    }
                }
            }
        }
    }
}

// ── Hero ─────────────────────────────────────────────────────────────────────

@Composable
private fun Hero(booking: Booking, onBack: () -> Unit, onHelp: () -> Unit) {
    val token = booking.doorToken

    Box(Modifier.fillMaxWidth().height(340.dp)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF2A1F1A))) {
            FuocoImage(booking.club?.coverImageUrl, Modifier.fillMaxSize())
        }
        // Deep wine scrim: dark enough at the foot for the title and the QR
        // card's shadow, clear in the middle so the venue photo still reads.
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0.00f to Color.Black.copy(alpha = 0.55f),
                    0.34f to Color.Black.copy(alpha = 0.10f),
                    0.78f to Color(0xFF4A1313).copy(alpha = 0.72f),
                    1.00f to Color(0xFF2A1F1A).copy(alpha = 0.95f),
                ),
            ),
        )

        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 62.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircleButton(Icons.AutoMirrored.Filled.KeyboardArrowLeft, onBack)
                Spacer(Modifier.weight(1f))
                token?.let {
                    Text(
                        "${stringResource(R.string.bookings_factTicket).uppercase()} · ${it.take(8)}",
                        fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.2.sp,
                        color = Color.White.copy(alpha = 0.92f),
                        maxLines = 1,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.34f))
                            .border(1.dp, Color.White.copy(alpha = 0.16f), CircleShape)
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
                Spacer(Modifier.weight(1f))
                // A door problem happens away from the app's other surfaces, so
                // help has to be reachable from the pass itself.
                CircleButton(Icons.AutoMirrored.Filled.HelpOutline, onHelp)
            }

            Spacer(Modifier.weight(1f))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    booking.brand?.attributionLabel
                        ?: stringResource(R.string.bookings_nightlife),
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.4.sp,
                    color = Color.White.copy(alpha = 0.8f),
                    maxLines = 1,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                StatusBadge(booking.status)
            }
            Text(
                booking.club?.name ?: "—",
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 34.sp, color = Color.White,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 7.dp),
            )
            Text(
                listOfNotNull(
                    dateLabel(booking, stringResource(R.string.bookings_tonight)).uppercase(),
                    doorsLabel(booking),
                    booking.club?.neighborhood?.uppercase(),
                ).filter { it.isNotEmpty() }.joinToString(" · "),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.2.sp,
                color = Color.White.copy(alpha = 0.78f),
                maxLines = 1,
                modifier = Modifier.padding(top = 7.dp),
            )
        }
    }
}

@Composable
private fun StatusBadge(status: String) {
    val (res, color) = when (status) {
        "cancelled" -> R.string.bookings_statusCancelled to Color(0xFF888888)
        "pending" -> R.string.bookings_statusPending to Theme.gold
        else -> R.string.bookings_statusConfirmed to Theme.accent
    }
    Text(
        stringResource(res).uppercase(),
        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 9.sp,
        letterSpacing = 0.8.sp, color = color,
        modifier = Modifier
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.34f))
            .border(1.dp, color.copy(alpha = 0.35f), CircleShape)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
private fun CircleButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.34f))
            .border(1.dp, Color.White.copy(alpha = 0.16f), CircleShape)
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(17.dp))
    }
}

// ── QR ───────────────────────────────────────────────────────────────────────

@Composable
private fun QrCard(token: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            // Always white with dark modules in both modes — door scanners read
            // the physical contrast, not the appearance.
            .background(FuocoFixed.qrSurface)
            .padding(horizontal = 20.dp, vertical = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            stringResource(R.string.bookings_atDoor).uppercase(),
            fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.5.sp,
            color = Theme.wine,
        )
        QrCode(token = token, modifier = Modifier.size(208.dp))
        // What we PRINT is the same token the QR encodes. Printing the CF-
        // reference under a scan_token QR invited staff to key in a code the
        // door rejects — the two must agree. Grouped in fours so it can be read
        // aloud or typed when a scan fails.
        Text(
            token.chunked(4).joinToString(" "),
            fontFamily = GeistMono, fontSize = 11.sp, letterSpacing = 1.2.sp,
            color = FuocoFixed.onQrSurface,
            textAlign = TextAlign.Center,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 6.dp),
        )
    }
}

// ── Sections ─────────────────────────────────────────────────────────────────

@Composable
private fun StatsStrip(booking: Booking) {
    Column {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
        Row(
            Modifier.fillMaxWidth().padding(vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatCell(
                stringResource(R.string.bookings_factDate),
                dateLabel(booking, stringResource(R.string.bookings_tonight)),
                Modifier.weight(1f),
            )
            StatCell(
                stringResource(R.string.bookings_factDoors),
                doorsLabel(booking),
                Modifier.weight(1f),
            )
            StatCell(
                stringResource(R.string.bookings_factGuests),
                booking.partySize.toString(),
                Modifier.weight(1f),
            )
            StatCell(
                stringResource(R.string.bookings_factTicket),
                ticketType(booking),
                Modifier.weight(1f),
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
    }
}

@Composable
private fun StatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            label.uppercase(),
            fontFamily = GeistMono, fontSize = 8.sp, letterSpacing = 1.sp,
            color = Theme.fadedSand, maxLines = 1,
        )
        Text(
            value,
            fontFamily = InstrumentSerif, fontSize = 17.sp, color = Theme.ink,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Only for bookings that cost something — a free guestlist has no receipt. */
@Composable
private fun Receipt(booking: Booking) {
    val total = booking.totalAmount ?: return
    if (total <= 0) return

    Section(stringResource(R.string.bookings_receipt)) {
        Column {
            ReceiptRow("${ticketType(booking)} × ${booking.partySize}", money(total))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
            ReceiptRow(
                stringResource(R.string.bookings_serviceFee),
                stringResource(R.string.bookings_included),
            )
            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
            ReceiptRow(
                stringResource(R.string.bookings_totalPaid),
                money(total),
                emphasised = true,
            )
        }
    }
}

@Composable
private fun ReceiptRow(label: String, value: String, emphasised: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = if (emphasised) 14.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            fontFamily = if (emphasised) InstrumentSerif else Geist,
            fontSize = if (emphasised) 19.sp else 14.sp,
            color = Theme.ink,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            fontFamily = if (emphasised) InstrumentSerif else Geist,
            fontSize = if (emphasised) 19.sp else 14.sp,
            color = if (emphasised) Theme.ink else Theme.stone,
        )
    }
}

@Composable
private fun WhereSection(booking: Booking) {
    val club = booking.club ?: return

    Section(stringResource(R.string.bookings_where)) {
        Row(
            Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(68.dp).clip(RoundedCornerShape(12.dp))) {
                FuocoImage(club.coverImageUrl, Modifier.fillMaxSize(), targetWidth = 68.dp)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    club.name,
                    fontFamily = InstrumentSerif, fontSize = 21.sp, color = Theme.ink,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                club.neighborhood?.takeIf { it.isNotEmpty() }?.let {
                    Text(
                        it.uppercase(),
                        fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.2.sp,
                        color = Theme.fadedSand,
                    )
                }
                club.address?.takeIf { it.isNotEmpty() }?.let {
                    Text(
                        it,
                        fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            title.uppercase(),
            fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.5.sp,
            color = Theme.wine,
        )
        content()
    }
}

@Composable
private fun ManageButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Theme.surface)
            .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
            .clickableUnlessBusy(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
    ) {
        Icon(icon, contentDescription = null, tint = Theme.ink, modifier = Modifier.size(15.dp))
        Text(
            title,
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
            color = Theme.ink,
        )
    }
}

@Composable
private fun OutlinedAction(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, color.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
            color = color,
        )
    }
}

// ── Formatting and actions ───────────────────────────────────────────────────

@Composable
private fun ticketType(booking: Booking): String = stringResource(
    if (booking.bookingType == "vip") R.string.bookings_vip else R.string.bookings_general,
)

/** The arrival window when the booking carries one, else the house default. */
private fun doorsLabel(booking: Booking): String =
    booking.arrivalWindow?.takeIf { it.isNotEmpty() } ?: "23:00"

private fun dateLabel(booking: Booking, tonight: String): String {
    val day = runCatching { LocalDate.parse(booking.bookingDate) }.getOrNull()
        ?: return booking.bookingDate
    if (day == LocalDate.now(ZoneId.of("Europe/Madrid"))) return tonight
    return day.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault()))
}

/** Whole euros read cleaner on a receipt; keep the cents when there are any. */
private fun money(value: Double): String =
    if (value == value.toLong().toDouble()) "€${value.toLong()}"
    else String.format(Locale.US, "€%.2f", value)

/**
 * Venue and night only — deliberately NO token. The printed code is the door
 * secret, and sharing it would hand someone else the entry.
 */
private fun shareBooking(context: Context, booking: Booking) {
    val text = listOfNotNull(booking.club?.name, booking.bookingDate).joinToString(" · ")
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, booking.club?.name ?: text))
}

private fun addBookingToCalendar(context: Context, booking: Booking) {
    val zone = ZoneId.of("Europe/Madrid")
    val day = runCatching { LocalDate.parse(booking.bookingDate) }.getOrNull() ?: return
    val doors = runCatching { LocalTime.parse(doorsLabel(booking).take(5)) }.getOrNull()
        ?: LocalTime.of(23, 0)

    val start = day.atTime(doors).atZone(zone).toInstant().toEpochMilli()
    val intent = Intent(Intent.ACTION_INSERT)
        .setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(
            CalendarContract.Events.TITLE,
            context.getString(R.string.groups_calendarTitle, booking.club?.name.orEmpty()),
        )
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, start + 4 * 60 * 60 * 1000)
        .putExtra(
            CalendarContract.Events.EVENT_LOCATION,
            booking.club?.address ?: booking.club?.name.orEmpty(),
        )
        .putExtra(
            CalendarContract.Events.DESCRIPTION,
            context.getString(R.string.groups_calendarNotes),
        )

    runCatching { context.startActivity(intent) }
}
