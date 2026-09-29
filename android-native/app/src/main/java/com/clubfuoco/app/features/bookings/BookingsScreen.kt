package com.clubfuoco.app.features.bookings

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.features.groups.GroupsListViewModel
import com.clubfuoco.app.models.GroupListItem
import com.clubfuoco.app.models.Booking
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The Tickets tab — tonight / upcoming / past across bookings, guest-list
 * signups and ticket orders, with the door QR. Port of `BookingsView`.
 */
@Composable
fun BookingsScreen(
    queries: Queries,
    api: ApiClient,
    onOpenGroup: (String) -> Unit,
    onOpenBooking: (Booking) -> Unit,
    onOpenSavedEvent: (String) -> Unit,
) {
    val model: BookingsViewModel = viewModel()
    val groupsModel: GroupsListViewModel = viewModel()
    var qrBooking by remember { mutableStateOf<Booking?>(null) }
    var reviewBooking by remember { mutableStateOf<Booking?>(null) }

    // Two pages, not two screens: Tickets and Reviews are the same list of
    // nights either side of the door, and swiping between them is cheaper than
    // a navigation push.
    val pager = rememberPagerState(pageCount = { 2 })
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        model.load(queries)
        groupsModel.load(api)
    }

    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        TopTabs(
            pager = pager,
            pendingCount = model.pendingReviews.size,
            onSelect = { page -> scope.launch { pager.animateScrollToPage(page) } },
        )

        when (val state = model.state) {
            is BookingsViewModel.LoadState.Loading ->
                Centered(stringResource(R.string.common_loading))

            is BookingsViewModel.LoadState.Failed ->
                Centered(state.message)

            is BookingsViewModel.LoadState.Loaded -> HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                if (page == 0) {
                    TicketsList(
                        model = model,
                        groupsModel = groupsModel,
                        onOpenGroup = onOpenGroup,
                        api = api,
                        onShowQr = { qrBooking = it },
                        onOpenBooking = onOpenBooking,
                        onOpenSavedEvent = onOpenSavedEvent,
                    )
                } else {
                    ReviewsList(model, api) { reviewBooking = it }
                }
            }
        }
    }

    qrBooking?.let { booking ->
        QrOverlay(booking) { qrBooking = null }
    }

    reviewBooking?.let { booking ->
        ReviewSurveySheet(
            booking = booking,
            api = api,
            onSubmitted = { model.markReviewSubmitted(it) },
            onClose = { reviewBooking = null },
        )
    }
}

/**
 * Tickets / Reviews. The Reviews tab carries a count badge, because a pending
 * review is the only thing on this screen that is waiting on the user.
 */
@Composable
private fun TopTabs(
    pager: PagerState,
    pendingCount: Int,
    onSelect: (Int) -> Unit,
) {
    val active = if (pager.currentPage + pager.currentPageOffsetFraction < 0.5f) 0 else 1

    Row(
        Modifier
            .statusBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        listOf(R.string.nav_tickets to 0, R.string.bookings_reviews to 1).forEach { (res, page) ->
            val on = active == page
            Row(
                Modifier.clickableUnlessBusy { onSelect(page) },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    stringResource(res),
                    fontFamily = InstrumentSerif,
                    fontSize = if (on) 34.sp else 24.sp,
                    color = if (on) Theme.ink else Theme.fadedSand,
                )
                if (page == 1 && pendingCount > 0) {
                    Box(
                        Modifier
                            .size(18.dp)
                            .clip(CircleShape)
                            .background(Theme.wine),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            pendingCount.toString(),
                            fontFamily = GeistMono, fontSize = 9.sp, color = Theme.cream,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewsList(
    model: BookingsViewModel,
    api: ApiClient,
    onOpenReview: (Booking) -> Unit,
) {
    val pending = model.pendingReviews

    if (pending.isEmpty()) {
        Column(
            Modifier.fillMaxSize().padding(top = 60.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Filled.StarBorder,
                contentDescription = null,
                tint = Theme.sand,
                modifier = Modifier.size(40.dp),
            )
            Text(
                stringResource(R.string.bookings_noReviews),
                fontFamily = Geist, fontSize = 14.sp, color = Theme.stone,
            )
            Text(
                stringResource(R.string.bookings_noReviewsSub),
                fontFamily = Geist, fontSize = 12.sp, color = Theme.fadedSand,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 40.dp),
            )
        }
        return
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Kicker(stringResource(R.string.bookings_tellUsHowItWent), color = Theme.wine)
        }
        items(pending, key = { "r-${it.id}" }) { booking ->
            ReviewCard(
                booking = booking,
                onClick = { onOpenReview(booking) },
                onDismiss = { model.dismissReview(booking.id, api) },
            )
        }
    }
}

@Composable
private fun ReviewCard(booking: Booking, onClick: () -> Unit, onDismiss: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .border(1.dp, Theme.wine.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .clickableUnlessBusy(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Theme.wine.copy(alpha = 0.08f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.StarBorder,
                contentDescription = null,
                tint = Theme.wine,
                modifier = Modifier.size(18.dp),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                booking.club?.name ?: stringResource(R.string.bookings_aNightOut),
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 17.sp, color = Theme.ink,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                shortDate(booking.bookingDate),
                fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
            )
        }
        // No swipe gesture here: this list sits inside a horizontal pager, and a
        // swipe-to-dismiss would fight the page swipe every time. An explicit
        // dismiss is unambiguous and reachable one-handed.
        Icon(
            Icons.Filled.Close,
            contentDescription = stringResource(R.string.bookings_dismissReview),
            tint = Theme.sand,
            modifier = Modifier
                .size(30.dp)
                .clip(CircleShape)
                .clickableUnlessBusy(onClick = onDismiss)
                .padding(8.dp),
        )
    }
}

@Composable
private fun TicketsList(
    model: BookingsViewModel,
    groupsModel: GroupsListViewModel,
    onOpenGroup: (String) -> Unit,
    api: ApiClient,
    onShowQr: (Booking) -> Unit,
    onOpenBooking: (Booking) -> Unit,
    onOpenSavedEvent: (String) -> Unit,
) {
    val tonight = model.tonight
    val upcoming = model.upcoming

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        // Bookmarked nights that are NOT yet paid for. Above the tickets so
        // they are seen, styled so they can never be mistaken for one.
        item {
            SavedEventsSection(
                api = api,
                onOpen = onOpenSavedEvent,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        // Unanswered group invites sit above everything: they are the only
        // thing on this screen with something still to do.
        val invites = groupsModel.pendingInvites
        if (invites.isNotEmpty()) {
            item { SectionHeader(stringResource(R.string.bookings_invited), tonight = true) }
            items(invites, key = { "gi-${it.id}" }) { group ->
                Box(Modifier.padding(horizontal = 20.dp)) {
                    GroupInviteCard(group) { onOpenGroup(group.id) }
                }
            }
        }

        if (groupsModel.groups.isNotEmpty()) {
            item { SectionHeader(stringResource(R.string.groups_strip), tonight = false) }
            items(groupsModel.groups, key = { "g-${it.id}" }) { group ->
                Box(Modifier.padding(horizontal = 20.dp)) {
                    GroupInviteCard(group) { onOpenGroup(group.id) }
                }
            }
        }

        if (tonight.isNotEmpty()) {
            item { SectionHeader(stringResource(R.string.bookings_tonight), tonight = true) }
            items(tonight, key = { itemKey(it) }) { ItemCard(it, tonight = true, onShowQr = onShowQr, onOpen = onOpenBooking) }
        }
        if (upcoming.isNotEmpty()) {
            item { SectionHeader(stringResource(R.string.bookings_upcoming), tonight = false) }
            items(upcoming, key = { itemKey(it) }) { ItemCard(it, tonight = false, onShowQr = onShowQr, onOpen = onOpenBooking) }
        }

        if (tonight.isEmpty() && upcoming.isEmpty()) {
            item {
                Column(
                    Modifier.fillMaxWidth().padding(top = 60.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        Icons.Filled.ConfirmationNumber,
                        contentDescription = null,
                        tint = Theme.sand,
                        modifier = Modifier.size(40.dp),
                    )
                    Text(
                        stringResource(R.string.bookings_noUpcoming),
                        fontFamily = Geist, fontSize = 15.sp, color = Theme.stone,
                    )
                    Text(
                        stringResource(
                            if (model.hasPast) R.string.bookings_noUpcomingPast
                            else R.string.bookings_noUpcomingSub,
                        ),
                        fontFamily = Geist, fontSize = 12.sp, color = Theme.fadedSand,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 40.dp),
                    )
                }
            }
        }

        if (model.hasPast) {
            item {
                Box(Modifier.padding(horizontal = 20.dp)) {
                    Kicker(
                        stringResource(
                            if (model.showPast) R.string.bookings_hidePast
                            else R.string.bookings_showPast,
                        ),
                        color = Theme.fadedSand,
                        modifier = Modifier.clickableUnlessBusy { model.showPast = !model.showPast },
                    )
                }
            }
            if (model.showPast) {
                items(model.past, key = { itemKey(it) }) {
                    ItemCard(it, tonight = false, past = true, onShowQr = onShowQr, onOpen = onOpenBooking)
                }
            }
        }
    }
}

private fun itemKey(item: BookingsViewModel.Item): String = when (item) {
    is BookingsViewModel.Item.Reservation -> "b-${item.booking.id}"
    is BookingsViewModel.Item.Signup -> "g-${item.signup.id}"
    is BookingsViewModel.Item.Ticket -> "t-${item.order.id}"
}

@Composable
private fun SectionHeader(title: String, tonight: Boolean) {
    Box(Modifier.padding(horizontal = 20.dp)) {
        Kicker(title, color = if (tonight) Theme.wine else Theme.fadedSand)
    }
}

@Composable
private fun ItemCard(
    item: BookingsViewModel.Item,
    tonight: Boolean,
    past: Boolean = false,
    onShowQr: (Booking) -> Unit,
    onOpen: (Booking) -> Unit,
) {
    Box(Modifier.padding(horizontal = 20.dp)) {
        when (item) {
            is BookingsViewModel.Item.Reservation ->
                BookingCard(item.booking, tonight, past, onShowQr, onOpen)
            is BookingsViewModel.Item.Signup -> SimpleCard(
                title = item.signup.guestList?.clubs?.name
                    ?: item.signup.guestList?.eventName.orEmpty(),
                subtitle = formatDate(item.date),
                kicker = item.signup.guestList?.freeEntryLabel
                    ?: stringResource(R.string.bookings_nightlife),
                past = past,
            )
            is BookingsViewModel.Item.Ticket -> SimpleCard(
                title = item.order.eventName ?: item.order.venueName.orEmpty(),
                subtitle = formatDate(item.date),
                kicker = item.order.venueName.orEmpty(),
                past = past,
            )
        }
    }
}

/**
 * The ticket card — hero, perforation, fact grid — mirroring the web "ticket"
 * treatment the iOS card converged on.
 */
@Composable
private fun BookingCard(
    booking: Booking,
    tonight: Boolean,
    past: Boolean,
    onShowQr: (Booking) -> Unit,
    onOpen: (Booking) -> Unit,
) {
    val cancelled = booking.status == "cancelled"

    // The whole card opens the pass page; "Show QR" stays as the fast path for
    // someone already standing at the door with their phone out.
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .clickableUnlessBusy { onOpen(booking) }
            .then(if (past) Modifier.alphaHalf() else Modifier),
    ) {
        Box(Modifier.fillMaxWidth().height(140.dp)) {
            FuocoImage(booking.club?.coverImageUrl, Modifier.fillMaxSize())
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.1f),
                        1f to Color.Black.copy(alpha = 0.65f),
                    ),
                ),
            )
            Row(Modifier.fillMaxWidth().padding(12.dp)) {
                Text(
                    stringResource(R.string.bookings_nightlife),
                    fontFamily = Geist, fontSize = 10.sp,
                    color = Color.White.copy(alpha = 0.85f),
                )
                Spacer(Modifier.weight(1f))
                if (cancelled) {
                    StatusPill(stringResource(R.string.bookings_cancelled), Theme.wine)
                } else if (tonight) {
                    StatusPill(stringResource(R.string.bookings_tonight), Theme.success)
                }
            }
            Column(
                Modifier.align(Alignment.BottomStart).padding(12.dp),
            ) {
                Text(
                    booking.club?.name ?: "—",
                    fontFamily = InstrumentSerif,
                    fontStyle = FontStyle.Italic,
                    fontSize = 22.sp,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    formatDate(booking.bookingDate),
                    fontFamily = Geist, fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
        }

        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FactCell(stringResource(R.string.bookings_factDate), shortDate(booking.bookingDate), Modifier.weight(1f))
                // The arrival window is the real door time; iOS hardcodes 23:00
                // here, which is wrong for any venue that opens earlier.
                FactCell(
                    stringResource(R.string.bookings_factDoors),
                    booking.arrivalWindow?.substringBefore("-")?.trim() ?: "—",
                    Modifier.weight(1f),
                )
                FactCell(stringResource(R.string.bookings_factGuests), "${booking.partySize}", Modifier.weight(1f))
                FactCell(
                    stringResource(R.string.bookings_factTicket),
                    stringResource(
                        if (booking.bookingType == "vip") R.string.bookings_vip
                        else R.string.bookings_general,
                    ),
                    Modifier.weight(1f),
                )
            }

            val token = booking.doorToken
            if (!cancelled && token != null) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    QrCode(
                        token,
                        Modifier
                            .size(46.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .clickableUnlessBusy { onShowQr(booking) },
                    )
                    Column(Modifier.weight(1f)) {
                        Text(
                            stringResource(R.string.bookings_atDoor),
                            fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                        )
                        booking.totalAmount?.takeIf { it > 0 }?.let {
                            Text(
                                "€${String.format("%.2f", it)}",
                                fontFamily = Geist, fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp, color = Theme.ink,
                            )
                        }
                    }
                    Text(
                        stringResource(R.string.bookings_showQR),
                        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
                        color = Theme.cream,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Theme.ink)
                            .clickableUnlessBusy { onShowQr(booking) }
                            .padding(horizontal = 14.dp, vertical = 9.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SimpleCard(title: String, subtitle: String, kicker: String, past: Boolean) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .then(if (past) Modifier.alphaHalf() else Modifier)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Kicker(kicker, color = Theme.fadedSand, size = 9.sp)
        Text(
            title.ifEmpty { "—" },
            fontFamily = InstrumentSerif, fontSize = 20.sp, color = Theme.ink,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(subtitle, fontFamily = Geist, fontSize = 12.sp, color = Theme.stone)
    }
}

@Composable
private fun FactCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Theme.cream)
            .padding(vertical = 8.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            label.uppercase(),
            fontFamily = GeistMono, fontSize = 8.sp, letterSpacing = 1.sp,
            color = Theme.fadedSand, textAlign = TextAlign.Center, maxLines = 1,
        )
        Text(
            value,
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
            color = Theme.ink, maxLines = 1,
        )
    }
}

@Composable
private fun StatusPill(text: String, color: Color) {
    Text(
        text.uppercase(),
        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 9.sp,
        letterSpacing = 0.8.sp, color = Color.White,
        modifier = Modifier
            .clip(CircleShape)
            .background(color)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** Full-screen pass, for actually presenting at the door. */
@Composable
private fun QrOverlay(booking: Booking, onDismiss: () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.92f))
            .clickableUnlessBusy(onClick = onDismiss),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                booking.club?.name ?: "—",
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 26.sp, color = Color.White,
            )
            booking.doorToken?.let {
                QrCode(it, Modifier.size(280.dp).clip(RoundedCornerShape(16.dp)))
            }
            booking.qrCodeToken?.let {
                Text(
                    it,
                    fontFamily = GeistMono, fontSize = 13.sp, letterSpacing = 2.sp,
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
            Text(
                stringResource(R.string.bookings_atDoor),
                fontFamily = Geist, fontSize = 12.sp, color = Color.White.copy(alpha = 0.5f),
            )
        }
    }
}

@Composable
private fun Centered(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand)
    }
}

/** Past entries read as history rather than something still actionable. */
private fun Modifier.alphaHalf(): Modifier = this.alpha(0.6f)

private fun formatDate(ymd: String): String = runCatching {
    LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.getDefault()))
}.getOrElse { ymd }

private fun shortDate(ymd: String): String = runCatching {
    LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("d MMM", Locale.getDefault()))
}.getOrElse { ymd }

@Composable
private fun GroupInviteCard(group: GroupListItem, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .clickableUnlessBusy(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)),
        ) {
            FuocoImage(group.club?.coverImageUrl, Modifier.fillMaxSize(), targetWidth = 56.dp)
        }
        Column(Modifier.weight(1f)) {
            Text(
                group.club?.name ?: stringResource(R.string.bookings_aNightOut),
                fontFamily = InstrumentSerif, fontSize = 20.sp, color = Theme.ink,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                formatDate(group.bookingDate),
                fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
            )
        }
        if (group.myRsvp == "invited") {
            Text(
                stringResource(R.string.bookings_invitedRespond),
                fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
                color = Theme.cream,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Theme.wine)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
    }
}
