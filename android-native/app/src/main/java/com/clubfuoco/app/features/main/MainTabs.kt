package com.clubfuoco.app.features.main

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.app.AppEnvironment
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.features.bookings.BookingDetailScreen
import com.clubfuoco.app.features.bookings.BookingsScreen
import com.clubfuoco.app.features.clubdetail.ClubDetailScreen
import com.clubfuoco.app.features.events.EventDetailScreen
import com.clubfuoco.app.features.explore.ExploreScreen
import com.clubfuoco.app.features.explore.ExploreViewModel
import com.clubfuoco.app.features.explore.ShelfListScreen
import com.clubfuoco.app.features.fiamme.FiammeScreen
import com.clubfuoco.app.features.groups.GroupDetailScreen
import com.clubfuoco.app.features.inviteclaim.InviteLinkRouter
import com.clubfuoco.app.features.location.LocationMode
import com.clubfuoco.app.features.location.LocationPermissionSheet
import com.clubfuoco.app.features.location.LocationPrompt
import com.clubfuoco.app.features.friends.FriendsScreen
import com.clubfuoco.app.features.notifications.NotificationsScreen
import com.clubfuoco.app.features.profile.ProfileScreen
import com.clubfuoco.app.features.settings.SettingsScreen
import com.clubfuoco.app.models.Booking
import com.clubfuoco.app.models.FeedEvent
import com.clubfuoco.app.models.Place

/**
 * The tab shell — Explore / Tickets / You. Port of `MainTabView`.
 *
 * The club and dj tab sets from the web app are deliberately absent: operator
 * surfaces are web-only, a decision already taken for iOS.
 */
private enum class Tab(val icon: ImageVector, val labelRes: Int) {
    EXPLORE(Icons.Filled.Explore, R.string.nav_explore),
    TICKETS(Icons.Filled.ConfirmationNumber, R.string.nav_tickets),
    YOU(Icons.Filled.Person, R.string.nav_you),
}

@Composable
fun MainTabs(env: AppEnvironment) {
    var selection by remember { mutableStateOf(Tab.EXPLORE) }
    val auth = env.authStore

    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        Box(Modifier.weight(1f)) {
            when (selection) {
                Tab.EXPLORE -> ExploreTab(env) { selection = Tab.TICKETS }
                Tab.TICKETS ->
                    if (auth.hasAccount) TicketsTab(env)
                    else GuestGateScreen(GateReason.TICKETS, auth)
                Tab.YOU ->
                    if (auth.hasAccount) YouTab(env)
                    else GuestGateScreen(GateReason.ACCOUNT, auth)
            }
        }
        TabBar(selection) { selection = it }
    }
}

@Composable
private fun ExploreTab(env: AppEnvironment, onOpenTickets: () -> Unit) {
    val model: ExploreViewModel = viewModel()
    val context = LocalContext.current
    val auth = env.authStore
    val plan = env.planStore

    var showGate by remember { mutableStateOf(false) }
    // The pushed venue / shelf are held here rather than serialised into the
    // route: Place is a rich model and round-tripping it through a nav argument
    // would mean re-fetching everything the feed already has in memory.
    var openPlace by remember { mutableStateOf<Place?>(null) }
    var openShelfId by remember { mutableStateOf<String?>(null) }
    var openEvent by remember { mutableStateOf<FeedEvent?>(null) }

    // The nearby pre-prompt, asked once per install on the first Explore open.
    // Asking here rather than at launch means the person has seen what the feed
    // is for before being asked to improve it.
    var showLocationAsk by remember {
        mutableStateOf(LocationPrompt.shouldAskNearby(context))
    }

    remember(model) {
        model.configure(env.queries, env.api, env.feedCache)
        true
    }

    val nightPhrase = plan.nightPhrase(
        java.util.Locale.getDefault(),
        context.getString(R.string.plan_tonight),
        context.getString(R.string.plan_tomorrow),
        context.getString(R.string.plan_next),
    )

    val shelf = openShelfId?.let { id -> model.shelves.firstOrNull { it.id == id } }

    if (showLocationAsk) {
        LocationPermissionSheet(LocationMode.NEARBY) {
            LocationPrompt.markNearbyAsked(context)
            showLocationAsk = false
        }
        return
    }

    when {
        // An event page sits above the venue it happens at: opening a route stop
        // from it pushes the club, and backing out returns to the event.
        openEvent != null && openPlace == null -> EventDetailScreen(
            event = openEvent!!,
            auth = auth,
            api = env.api,
            queries = env.queries,
            onOpenPlace = { openPlace = it },
            onNeedsAccount = { showGate = true },
            onBack = { openEvent = null },
        )

        openPlace != null -> ClubDetailScreen(
            place = openPlace!!,
            queries = env.queries,
            api = env.api,
            planDate = plan.date,
            nightPhrase = nightPhrase,
            hasAccount = auth.hasAccount,
            onNeedsAccount = { showGate = true },
            onOpenTickets = { openPlace = null; onOpenTickets() },
            onBack = { openPlace = null },
        )

        shelf != null -> ShelfListScreen(
            shelf = shelf,
            saved = model.saved,
            onBack = { openShelfId = null },
            onOpenPlace = { openPlace = it },
            onSave = { place -> if (!model.toggleSave(place, auth.hasAccount)) showGate = true },
        )

        showGate -> GuestGateScreen(GateReason.SAVE, auth)

        else -> ExploreScreen(
            model = model,
            auth = auth,
            plan = plan,
            nightPhrase = nightPhrase,
            onOpenPlace = { openPlace = it },
            onOpenShelf = { openShelfId = it.id },
            onOpenEvent = { openEvent = it },
            onNeedsAccount = { showGate = true },
        )
    }

    // Android's back gesture should unwind these in-tab pushes before it leaves
    // the app, so each one registers its own handler.
    BackHandler(enabled = openPlace != null) { openPlace = null }
    BackHandler(enabled = openPlace == null && openEvent != null) { openEvent = null }
    BackHandler(enabled = openPlace == null && openEvent == null && shelf != null) {
        openShelfId = null
    }
    BackHandler(
        enabled = openPlace == null && openEvent == null && shelf == null && showGate,
    ) { showGate = false }
}

@Composable
private fun TicketsTab(env: AppEnvironment) {
    var openGroupId by remember { mutableStateOf<String?>(null) }
    var openBooking by remember { mutableStateOf<Booking?>(null) }

    val groupId = openGroupId
    val booking = openBooking

    when {
        groupId != null -> {
            GroupDetailScreen(groupId, env.api) { openGroupId = null }
            BackHandler { openGroupId = null }
        }

        booking != null -> BookingDetailScreen(
            booking = booking,
            api = env.api,
            // Only an upcoming reservation that has not already been cancelled
            // can still be given up.
            canCancel = booking.status != "cancelled" &&
                booking.bookingDate >= java.time.LocalDate.now().toString(),
            onConfirmCancel = { openBooking = null },
            onAttendanceChanged = { openBooking = null },
            onBack = { openBooking = null },
        )

        else -> BookingsScreen(
            queries = env.queries,
            api = env.api,
            onOpenGroup = { openGroupId = it },
            onOpenBooking = { openBooking = it },
            // A saved night has no ticket yet — the invite screen is where it
            // gets paid for, so tapping one routes back through the same claim
            // flow the original link opened.
            onOpenSavedEvent = { InviteLinkRouter.pendingToken = it },
        )
    }
}

private enum class YouRoute { PROFILE, SETTINGS, FRIENDS, NOTIFICATIONS, FIAMME }

@Composable
private fun YouTab(env: AppEnvironment) {
    var route by remember { mutableStateOf(YouRoute.PROFILE) }

    when (route) {
        YouRoute.PROFILE -> ProfileScreen(
            auth = env.authStore,
            queries = env.queries,
            onOpenSettings = { route = YouRoute.SETTINGS },
            onOpenFriends = { route = YouRoute.FRIENDS },
            onOpenNotifications = { route = YouRoute.NOTIFICATIONS },
            onOpenFiamme = { route = YouRoute.FIAMME },
        )
        YouRoute.SETTINGS -> SettingsScreen(
            auth = env.authStore,
            api = env.api,
            localeStore = env.localeStore,
            themeStore = env.themeStore,
            onBack = { route = YouRoute.PROFILE },
        )
        YouRoute.FRIENDS -> FriendsScreen(env.api) { route = YouRoute.PROFILE }
        YouRoute.NOTIFICATIONS -> NotificationsScreen(env.api) { route = YouRoute.PROFILE }
        YouRoute.FIAMME -> FiammeScreen(env.api) { route = YouRoute.PROFILE }
    }

    BackHandler(enabled = route != YouRoute.PROFILE) { route = YouRoute.PROFILE }
}

@Composable
private fun TabBar(selection: Tab, onSelect: (Tab) -> Unit) {
    Column {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
        androidx.compose.foundation.layout.Row(
            Modifier
                .background(Theme.cream)
                .navigationBarsPadding()
                .padding(vertical = 8.dp),
        ) {
            Tab.entries.forEach { tab ->
                val active = tab == selection
                Column(
                    Modifier
                        .weight(1f)
                        .clickableUnlessBusy { onSelect(tab) }
                        .padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        tab.icon,
                        contentDescription = null,
                        tint = if (active) Theme.ink else Theme.sand,
                        modifier = Modifier.size(22.dp),
                    )
                    Text(
                        stringResource(tab.labelRes),
                        fontFamily = Geist,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        fontSize = 10.sp,
                        color = if (active) Theme.ink else Theme.sand,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PlaceholderTab(name: String) {
    Box(Modifier.fillMaxSize().background(Theme.cream), contentAlignment = Alignment.Center) {
        Text(name, fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand)
    }
}
