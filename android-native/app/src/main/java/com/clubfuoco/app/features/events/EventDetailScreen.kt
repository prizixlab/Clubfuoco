package com.clubfuoco.app.features.events

import android.content.Context
import android.content.Intent
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
import androidx.compose.foundation.layout.navigationBarsPadding
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.features.clubdetail.DjScreen
import com.clubfuoco.app.models.FeaturedDJ
import com.clubfuoco.app.models.FeedEvent
import com.clubfuoco.app.models.Place
import com.clubfuoco.app.stores.AuthStore

/**
 * The event page — hero, then title → hosts → tickets → schedule → line-up →
 * about → details, with the reserve dock pinned to the bottom.
 *
 * Port of `EventDetailView`. The iOS version tracks scroll offset to fade in a
 * blurred title bar over the hero; that is dropped here in favour of a plain
 * back control, because Compose has no cheap equivalent of `.ultraThinMaterial`
 * and a fake blur over a photo looks worse than no bar at all.
 */
@Composable
fun EventDetailScreen(
    event: FeedEvent,
    auth: AuthStore,
    api: ApiClient,
    queries: Queries,
    onOpenPlace: (Place) -> Unit,
    onNeedsAccount: () -> Unit,
    onBack: () -> Unit,
) {
    val model: EventDetailViewModel = viewModel(key = "event:${event.id}")
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current

    var showPass by remember { mutableStateOf(false) }
    var confirmCancel by remember { mutableStateOf(false) }
    var activeDj by remember { mutableStateOf<FeaturedDJ?>(null) }

    val tonight = stringResource(R.string.plan_tonight)
    val tomorrow = stringResource(R.string.plan_tomorrow)
    val reserveFailed = stringResource(R.string.events_reserveFailed)
    val checkoutFailed = stringResource(R.string.events_checkoutFailed)

    remember(model) { model.start(event, api, queries); true }

    LaunchedEffect(model.checkoutUrl) {
        model.checkoutUrl?.let {
            uriHandler.openUri(it)
            model.checkoutUrl = null
        }
    }

    // The DJ page takes the whole screen, same as from a club page.
    activeDj?.let { dj ->
        DjScreen(dj = dj, queries = queries) { activeDj = null }
        BackHandler { activeDj = null }
        return
    }

    if (showPass) {
        ReservedSheet(
            event = event,
            bookingId = model.bookingId,
            scanToken = model.scanToken,
            reference = model.reference,
        ) { showPass = false }
        return
    }

    BackHandler(onBack = onBack)

    Box(Modifier.fillMaxSize().background(Theme.cream)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            if (event.image != null) Hero(event, tonight, tomorrow)

            Column(
                Modifier
                    .fillMaxWidth()
                    .then(
                        // The sheet rides up over the hero's lower edge; with no
                        // hero it just clears the back control. `offset` rather
                        // than negative padding, which Compose rejects.
                        if (event.image != null) {
                            Modifier.offset(y = (-26).dp)
                        } else {
                            Modifier.padding(top = 80.dp)
                        },
                    )
                    .clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp))
                    .background(Theme.cream)
                    .padding(horizontal = 20.dp)
                    .padding(top = 22.dp, bottom = 40.dp),
            ) {
                Text(
                    event.displayTitle,
                    fontFamily = InstrumentSerif, fontSize = 31.sp, lineHeight = 34.sp,
                    color = Theme.ink,
                )

                SubLine(event, Modifier.padding(top = 12.dp))

                if (event.hostCredits.isNotEmpty()) {
                    HostsRow(event, Modifier.padding(top = 16.dp))
                }

                // Price, and where it is going. On a night that sells in waves
                // this is the only place a guest can see that waiting costs more
                // — so it sits above the line-up, not buried under it.
                if (event.ladder.isNotEmpty() || (event.priceCents ?: 0) > 0) {
                    Section(stringResource(R.string.events_tickets)) { TicketLadder(event) }
                }

                // The schedule outranks the billing on a night that moves: the
                // first thing you need is where to be and when, and only then
                // who is playing.
                if (event.isRoute) {
                    Section(stringResource(R.string.events_schedule)) {
                        RouteTimeline(event, model, onOpenPlace)
                    }
                }

                Section(stringResource(R.string.events_lineup)) {
                    if (event.credits.isEmpty()) {
                        Text(
                            stringResource(R.string.events_noLineup),
                            fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                            modifier = Modifier.padding(vertical = 10.dp),
                        )
                    } else {
                        LineupList(event, model) { activeDj = it }
                    }
                }

                event.description?.takeIf { it.isNotEmpty() }?.let { about ->
                    Section(stringResource(R.string.events_about)) {
                        Text(
                            about,
                            fontFamily = Geist, fontSize = 13.5.sp, lineHeight = 20.sp,
                            color = Theme.stone,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                }

                Section(stringResource(R.string.events_details)) {
                    DetailRows(event, tonight, tomorrow)
                }

                // Clearance for the docked control below.
                Spacer(Modifier.height(140.dp))
            }
        }

        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundControl(Icons.AutoMirrored.Filled.KeyboardArrowLeft, onBack)
            Spacer(Modifier.weight(1f))
            RoundControl(Icons.Filled.Share) { shareEvent(context, event) }
        }

        Dock(
            event = event,
            model = model,
            auth = auth,
            api = api,
            reserveFailed = reserveFailed,
            checkoutFailed = checkoutFailed,
            confirmCancel = confirmCancel,
            onConfirmCancel = { confirmCancel = it },
            onNeedsAccount = onNeedsAccount,
            onShowPass = { showPass = true },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

// ── Hero ─────────────────────────────────────────────────────────────────────

@Composable
private fun Hero(event: FeedEvent, tonight: String, tomorrow: String) {
    Box(Modifier.fillMaxWidth().height(352.dp)) {
        FuocoImage(event.image, Modifier.fillMaxSize())
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0.0f to Color.Black.copy(alpha = 0.55f),
                    0.34f to Color.Transparent,
                    0.58f to Color.Black.copy(alpha = 0.15f),
                    // Runs all the way to the page colour, so the sheet emerges
                    // from the photo rather than cutting it off.
                    0.99f to Theme.cream,
                ),
            ),
        )

        Column(
            Modifier.align(Alignment.BottomStart).padding(20.dp).padding(bottom = 26.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (event.pinned) {
                Row(
                    Modifier
                        .clip(CircleShape)
                        .background(Theme.gold)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        Icons.Filled.Star, contentDescription = null,
                        // Dark ink on gold, not white: white on #C09950 is about
                        // 2:1 and unreadable at this size.
                        tint = FuocoFixed.onQrSurface, modifier = Modifier.size(9.dp),
                    )
                    Text(
                        stringResource(R.string.events_pickTag).uppercase(),
                        fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
                        color = FuocoFixed.onQrSurface,
                    )
                }
            }

            Row(
                Modifier
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.45f))
                    .border(1.dp, Color.White.copy(alpha = 0.16f), CircleShape)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (event.isTonight) {
                    Box(
                        Modifier.size(7.dp).clip(CircleShape).background(Theme.accent),
                    )
                    Text(
                        stringResource(R.string.events_onTonight),
                        fontFamily = GeistMono, fontWeight = FontWeight.Medium,
                        fontSize = 10.sp, letterSpacing = 1.4.sp, color = Color.White,
                    )
                    event.timeLabel?.let {
                        Text(
                            "· $it",
                            fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 1.4.sp,
                            color = Color(0xFFFFD9C6),
                        )
                    }
                } else {
                    Text(
                        listOfNotNull(event.dayLabel(tonight, tomorrow), event.timeLabel)
                            .joinToString(" · ").uppercase(),
                        fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 1.4.sp,
                        color = Color.White,
                    )
                }
            }
        }
    }
}

// ── Body ─────────────────────────────────────────────────────────────────────

/** Venue · Free entry · Room of N — the facts that decide whether to read on. */
@Composable
private fun SubLine(event: FeedEvent, modifier: Modifier = Modifier) {
    val parts = listOfNotNull(
        // The whole route on a night that moves: printing the first venue alone
        // would claim the night happens in one place.
        event.placeLine,
        if (event.isFree) stringResource(R.string.events_free) else null,
        event.totalCapacity?.let { stringResource(R.string.events_roomOf, it) },
    )

    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        parts.forEachIndexed { index, part ->
            if (index > 0) {
                Box(Modifier.size(3.dp).clip(CircleShape).background(Theme.fadedSand))
            }
            Text(
                part.uppercase(),
                fontFamily = GeistMono, fontSize = 10.5.sp, letterSpacing = 1.2.sp,
                color = Theme.stone,
            )
        }
    }
}

@Composable
private fun HostsRow(event: FeedEvent, modifier: Modifier = Modifier) {
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Overlapping initial discs.
        Row(horizontalArrangement = Arrangement.spacedBy((-8).dp)) {
            event.hostCredits.forEach { host ->
                Box(
                    Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(Theme.surface)
                        .border(1.dp, Theme.hairline, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        host.name.take(1).uppercase(),
                        fontFamily = Geist, fontWeight = FontWeight.Bold, fontSize = 11.sp,
                        color = Theme.accent,
                    )
                }
            }
        }
        Text(
            "${stringResource(R.string.events_hostedBy)} ${event.hostLine.orEmpty()}",
            fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The price now, what it becomes, and the whole ladder underneath.
 *
 * A flat-priced night renders just the first line — a one-row "ladder" would
 * imply a change that is not coming.
 */
@Composable
private fun TicketLadder(event: FeedEvent) {
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (event.soldOut) {
                Text(
                    stringResource(R.string.events_soldOut),
                    fontFamily = Geist, fontWeight = FontWeight.Bold, fontSize = 26.sp,
                    color = Theme.fadedSand,
                )
            } else {
                Text(
                    priceNow(event),
                    fontFamily = Geist, fontWeight = FontWeight.Bold, fontSize = 26.sp,
                    color = Theme.ink,
                )
                event.liveRelease?.name?.takeIf { it.isNotEmpty() }?.let {
                    Spacer(Modifier.width(10.dp))
                    Text(
                        it,
                        fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 12.sp,
                        color = Theme.fadedSand,
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            event.liveRelease?.remaining()?.let { left ->
                Text(
                    stringResource(R.string.events_ticketsLeft, left),
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 11.sp,
                    color = Theme.accent,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Theme.accent.copy(alpha = 0.12f))
                        .padding(horizontal = 9.dp, vertical = 5.dp),
                )
            }
        }

        // The whole point of releases: say plainly that waiting costs more.
        val live = event.liveRelease
        val next = event.nextRelease
        if (live != null && next != null) {
            Text(
                when {
                    live.endsAtInstant != null ->
                        stringResource(R.string.events_priceFrom, next.priceText, switchLabel(live))
                    live.quantity != null ->
                        stringResource(R.string.events_priceWhenGone, next.priceText)
                    else -> stringResource(R.string.events_priceNext, next.priceText)
                },
                fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
            )
        }

        if (event.ladder.size > 1) {
            Column {
                event.ladder.forEach { release ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        // Filled for the wave on sale, hollow for one still to
                        // come, nothing for one already spent.
                        Box(
                            Modifier
                                .size(7.dp)
                                .clip(CircleShape)
                                .background(if (release.isLive) Theme.accent else Color.Transparent)
                                .then(
                                    if (release.state == "upcoming") {
                                        Modifier.border(1.dp, Theme.fadedSand, CircleShape)
                                    } else {
                                        Modifier
                                    },
                                ),
                        )
                        Text(
                            release.name?.takeIf { it.isNotEmpty() }
                                ?: stringResource(R.string.events_releaseN, release.position),
                            fontFamily = Geist,
                            fontWeight = if (release.isLive) FontWeight.SemiBold else FontWeight.Normal,
                            fontSize = 13.sp,
                            color = if (release.spent) Theme.fadedSand else Theme.ink,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            if (release.state == "sold_out") {
                                stringResource(R.string.events_soldOut)
                            } else {
                                release.priceText
                            },
                            fontFamily = Geist,
                            fontWeight = if (release.isLive) FontWeight.SemiBold else FontWeight.Normal,
                            fontSize = 13.sp,
                            color = if (release.spent) Theme.fadedSand else Theme.ink,
                        )
                    }
                    if (release !== event.ladder.last()) {
                        Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
                    }
                }
            }
        }
    }
}

private fun priceNow(event: FeedEvent): String {
    val cents = event.priceCents ?: 0
    if (cents == 0) return "—"
    return if (cents % 100 == 0) "€${cents / 100}"
    else String.format(java.util.Locale.US, "€%.2f", cents / 100.0)
}

private fun switchLabel(release: com.clubfuoco.app.models.TicketRelease): String {
    val instant = release.endsAtInstant ?: return ""
    return instant.atZone(java.time.ZoneId.of("Europe/Madrid"))
        .format(java.time.format.DateTimeFormatter.ofPattern("EEE d MMM", java.util.Locale.getDefault()))
}

/**
 * Numbered billing. The headliner is set larger with an accent number — order
 * carries meaning here, so the list shows it rather than flattening everyone to
 * one weight.
 */
@Composable
private fun LineupList(
    event: FeedEvent,
    model: EventDetailViewModel,
    onOpenDj: (FeaturedDJ) -> Unit,
) {
    Column(Modifier.padding(top = 6.dp)) {
        event.credits.forEachIndexed { index, credit ->
            val artist = model.djFor(credit)
            Row(
                Modifier
                    .fillMaxWidth()
                    .then(
                        if (artist != null) {
                            Modifier.clickableUnlessBusy { onOpenDj(artist) }
                        } else {
                            Modifier
                        },
                    )
                    .padding(vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "%02d".format(index + 1),
                    fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 0.6.sp,
                    color = if (index == 0) Theme.accent else Theme.fadedSand,
                    modifier = Modifier.width(24.dp),
                )
                Text(
                    credit.name,
                    fontFamily = Geist,
                    fontWeight = if (index == 0) FontWeight.Bold else FontWeight.SemiBold,
                    fontSize = if (index == 0) 21.sp else 17.sp,
                    color = Theme.ink,
                    modifier = Modifier.weight(1f),
                )
                // Only resolvable credits get a chevron. A credit with no
                // catalogue row still renders — it just has nowhere to go, and
                // promising a page that does not exist is worse than a plain
                // name.
                if (artist != null) {
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = Theme.fadedSand,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
        }
    }
}

/**
 * The route as a timeline: a dot per stop joined by a rail.
 *
 * A plain list of "22:00 Bastión / 00:00 Opium" rows carries the same facts, but
 * the rail is what says these are legs of ONE night in order rather than two
 * events someone has to choose between.
 */
@Composable
private fun RouteTimeline(
    event: FeedEvent,
    model: EventDetailViewModel,
    onOpenPlace: (Place) -> Unit,
) {
    Column(Modifier.padding(top = 10.dp)) {
        event.route.forEachIndexed { index, stop ->
            val place = stop.clubId?.let { model.stopPlaces[it.lowercase()] }
            val isLast = index == event.route.size - 1

            Row(
                Modifier
                    .fillMaxWidth()
                    .then(
                        if (place != null) {
                            Modifier.clickableUnlessBusy { onOpenPlace(place) }
                        } else {
                            Modifier
                        },
                    ),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(
                    Modifier.padding(top = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier
                            .size(11.dp)
                            .clip(CircleShape)
                            .background(if (index == 0) Theme.accent else Theme.cream)
                            .border(
                                1.5.dp,
                                if (index == 0) Theme.accent else Theme.hairline,
                                CircleShape,
                            ),
                    )
                    if (!isLast) {
                        // Stretches to whatever height the stop's text needs, so
                        // the rail always meets the next dot.
                        Box(Modifier.width(1.dp).height(56.dp).background(Theme.hairline))
                    }
                }

                Column(
                    Modifier.weight(1f).padding(bottom = if (isLast) 0.dp else 20.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    stop.timeLabel?.let {
                        Text(
                            it,
                            fontFamily = GeistMono, fontSize = 10.5.sp, letterSpacing = 1.2.sp,
                            color = if (index == 0) Theme.accent else Theme.stone,
                        )
                    }
                    Text(
                        stop.name,
                        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
                        color = Theme.ink,
                    )
                    stop.note?.let {
                        Text(it, fontFamily = Geist, fontSize = 12.5.sp, color = Theme.stone)
                    }
                }

                if (place != null) {
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = Theme.fadedSand,
                        modifier = Modifier.padding(top = 2.dp).size(14.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun DetailRows(event: FeedEvent, tonight: String, tomorrow: String) {
    Column(Modifier.padding(top = 8.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))

        if (event.isRoute) {
            // The timeline above already gives times and notes per stop, so this
            // row just states the shape of the night.
            DetailRow(
                stringResource(R.string.events_where),
                stringResource(R.string.events_stopCount, event.route.size),
                event.routeLine,
            )
        } else {
            event.venueName?.let {
                DetailRow(stringResource(R.string.events_where), it, event.address)
            }
        }

        DetailRow(
            stringResource(R.string.events_when),
            event.dayLabel(tonight, tomorrow),
            event.timeLabel,
        )

        if (event.isFree) {
            DetailRow(
                stringResource(R.string.events_entry),
                stringResource(R.string.events_free),
                stringResource(R.string.events_entryNote),
            )
        }

        event.totalCapacity?.takeIf { it > 0 }?.let {
            DetailRow(
                stringResource(R.string.events_room),
                stringResource(R.string.events_roomHolds, it),
                null,
            )
        }
    }
}

@Composable
private fun DetailRow(key: String, value: String, sub: String?) {
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
            Text(
                key.uppercase(),
                fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.5.sp,
                color = Theme.fadedSand,
                modifier = Modifier.width(88.dp).padding(top = 3.dp),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(value, fontFamily = Geist, fontSize = 13.5.sp, color = Theme.ink)
                sub?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, fontFamily = Geist, fontSize = 12.5.sp, color = Theme.stone)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
    }
}

@Composable
private fun Section(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 26.dp)) {
        Text(
            label.uppercase(),
            fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 2.1.sp,
            color = Theme.accent,
        )
        content()
    }
}

@Composable
private fun RoundControl(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(38.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .border(1.dp, Color.White.copy(alpha = 0.16f), CircleShape)
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
    }
}

// ── The dock ─────────────────────────────────────────────────────────────────

@Composable
private fun Dock(
    event: FeedEvent,
    model: EventDetailViewModel,
    auth: AuthStore,
    api: ApiClient,
    reserveFailed: String,
    checkoutFailed: String,
    confirmCancel: Boolean,
    onConfirmCancel: (Boolean) -> Unit,
    onNeedsAccount: () -> Unit,
    onShowPass: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Hidden entirely where a reservation is impossible: `bookings.club_id` is
    // NOT NULL, so a night at a free-text address has nothing to book against,
    // and a button that always errors is worse than none.
    if (event.clubId == null) return

    val state = model.dockState(auth.hasAccount)

    Column(
        modifier
            .fillMaxWidth()
            .background(Theme.surface)
            .navigationBarsPadding()
            .padding(horizontal = 20.dp)
            .padding(top = 16.dp, bottom = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        model.errorText?.let {
            Text(
                it,
                fontFamily = Geist, fontSize = 12.sp, color = Theme.wine,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }

        // Giving a spot up sits behind a confirmation, because it is the same
        // control that a moment ago meant "reserve" and a mis-tap would silently
        // drop someone off the door list.
        if (confirmCancel) {
            Text(
                stringResource(R.string.events_cancelBody),
                fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 10.dp),
            )
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                DockShell(
                    label = stringResource(R.string.common_cancel),
                    fill = Theme.surface,
                    stroke = Theme.hairline,
                    text = Theme.stone,
                    modifier = Modifier.weight(1f),
                ) { onConfirmCancel(false) }
                DockShell(
                    label = stringResource(R.string.events_cancelConfirm),
                    fill = Theme.wine,
                    stroke = null,
                    text = Theme.cream,
                    modifier = Modifier.weight(1f),
                ) {
                    onConfirmCancel(false)
                    model.cancel(event, api, reserveFailed)
                }
            }
            return@Column
        }

        when (state) {
            EventDetailViewModel.Dock.WORKING -> DockShell(
                label = stringResource(R.string.events_reserving),
                fill = Theme.accent.copy(alpha = 0.72f),
                stroke = null,
                text = Theme.cream,
                enabled = false,
            ) {}

            EventDetailViewModel.Dock.RESERVED -> DockShell(
                label = stringResource(R.string.events_reserved),
                fill = Theme.accent.copy(alpha = 0.12f),
                stroke = Theme.accent.copy(alpha = 0.4f),
                text = Theme.ink,
                icon = Icons.Filled.Check,
            ) { onConfirmCancel(true) }

            EventDetailViewModel.Dock.FULL -> DockShell(
                label = stringResource(R.string.events_fullTitle),
                fill = Theme.surface,
                stroke = Theme.hairline,
                text = Theme.fadedSand,
                enabled = false,
            ) {}

            EventDetailViewModel.Dock.SIGNED_OUT -> DockShell(
                label = stringResource(R.string.events_joinToReserve),
                fill = Color.Transparent,
                stroke = Theme.accent,
                text = Theme.accent,
                onClick = onNeedsAccount,
            )

            EventDetailViewModel.Dock.READY -> when {
                event.soldOut -> DockShell(
                    label = stringResource(R.string.events_soldOut),
                    fill = Theme.surface,
                    stroke = Theme.hairline,
                    text = Theme.fadedSand,
                    enabled = false,
                ) {}

                // A ticketed night cannot be "reserved" — the reserve route
                // refuses anything priced, so an RSVP button on a paid event was
                // a guaranteed error. It buys instead.
                event.isTicketed -> DockShell(
                    label = stringResource(R.string.events_buyFor, priceNow(event)),
                    fill = Theme.accent,
                    stroke = null,
                    text = Theme.cream,
                ) { model.buy(event, api, buyerName(auth), checkoutFailed) }

                else -> DockShell(
                    label = stringResource(R.string.events_reserve),
                    fill = Theme.accent,
                    stroke = null,
                    text = Theme.cream,
                ) { model.reserve(event, api, reserveFailed, onShowPass) }
            }
        }

        if (state == EventDetailViewModel.Dock.RESERVED) {
            Row(
                Modifier.padding(top = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    stringResource(R.string.events_viewPass),
                    fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.4.sp,
                    color = Theme.accent,
                    modifier = Modifier.clickableUnlessBusy(onClick = onShowPass),
                )
                Box(Modifier.width(1.dp).height(11.dp).background(Theme.hairline))
                Text(
                    stringResource(R.string.events_cancelRsvp),
                    fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.4.sp,
                    color = Theme.fadedSand,
                    modifier = Modifier.clickableUnlessBusy { onConfirmCancel(true) },
                )
            }
        } else {
            Text(
                when (state) {
                    EventDetailViewModel.Dock.WORKING ->
                        stringResource(R.string.events_holdingSpot)
                    EventDetailViewModel.Dock.FULL ->
                        stringResource(R.string.events_fullNote, event.totalCapacity ?: 0)
                    EventDetailViewModel.Dock.SIGNED_OUT ->
                        stringResource(R.string.events_joinNote)
                    else -> stringResource(R.string.events_reserveHint)
                },
                fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.1.sp,
                color = Theme.fadedSand,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}

@Composable
private fun DockShell(
    label: String,
    fill: Color,
    stroke: Color?,
    text: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(CircleShape)
            .background(fill)
            .then(if (stroke != null) Modifier.border(1.dp, stroke, CircleShape) else Modifier)
            .clickableUnlessBusy(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp, Alignment.CenterHorizontally),
    ) {
        icon?.let {
            Icon(it, contentDescription = null, tint = text, modifier = Modifier.size(16.dp))
        }
        Text(
            label,
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.5.sp,
            color = text,
        )
    }
}

/**
 * The name that goes on the door list: the profile's, or the email's local part
 * as a last resort. The endpoint requires one, and refusing a sale over a
 * missing display name would be absurd.
 */
private fun buyerName(auth: AuthStore): String {
    auth.profile?.fullName?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    auth.user?.email?.substringBefore("@")?.takeIf { it.isNotEmpty() }?.let { return it }
    return "Guest"
}

private fun shareEvent(context: Context, event: FeedEvent) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, "https://clubfuoco.com/events/${event.id}")
        putExtra(Intent.EXTRA_SUBJECT, event.displayTitle)
    }
    context.startActivity(Intent.createChooser(intent, event.displayTitle))
}
