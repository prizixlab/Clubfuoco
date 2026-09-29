package com.clubfuoco.app.features.profile

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.automirrored.filled.HelpOutline
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.LegalUrls
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.stores.AuthStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The You tab — identity card, stats strip, menu, sign out. Port of
 * `ProfileView`.
 */
@Composable
fun ProfileScreen(
    auth: AuthStore,
    queries: Queries,
    onOpenSettings: () -> Unit,
    onOpenFriends: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenFiamme: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    var nights by remember { mutableStateOf<Int?>(null) }
    var bookingsTotal by remember { mutableStateOf<Int?>(null) }
    var savedCount by remember { mutableStateOf<Int?>(null) }
    var friendCount by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(Unit) {
        auth.refreshProfile()
        withContext(Dispatchers.IO) {
            val data = runCatching { queries.myBookings() }.getOrNull()
            if (data != null) {
                // Every night counts toward the score — paid bookings,
                // guestlist signups and ticket orders alike. Never counts down.
                nights = data.bookings.size + data.guestSignups.size + data.ticketOrders.size
                bookingsTotal = data.bookings.size
            }
            savedCount = runCatching { queries.placeFavoriteIds().size }.getOrNull()
        }
    }

    val fullName = auth.profile?.fullName.orEmpty()
    val parts = fullName.split(" ").filter { it.isNotEmpty() }
    val first = parts.firstOrNull().orEmpty()
    val last = parts.drop(1).joinToString(" ")
    val initials = parts.take(2).mapNotNull { it.firstOrNull() }
        .joinToString("").uppercase().ifEmpty { "?" }

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Kicker(stringResource(R.string.profile_header), color = Theme.fadedSand)
            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(Theme.surface)
                        .clickableUnlessBusy(onClick = onOpenNotifications),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Notifications, null, tint = Theme.stone, modifier = Modifier.size(16.dp))
                }
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(Theme.surface)
                        .clickableUnlessBusy(onClick = onOpenSettings),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Settings, null, tint = Theme.stone, modifier = Modifier.size(16.dp))
                }
            }
        }

        IdentityCard(
            first = first,
            last = last,
            initials = initials,
            email = auth.profile?.email ?: auth.user?.email.orEmpty(),
            memberYear = auth.profile?.createdAt?.take(4) ?: "—",
            modifier = Modifier.padding(horizontal = 20.dp),
        )

        Row(Modifier.fillMaxWidth().padding(20.dp)) {
            Stat(nights, "Notti", stringResource(R.string.profile_statNights), Modifier.weight(1f))
            Divider()
            Stat(savedCount, "Salvati", stringResource(R.string.profile_statSaved), Modifier.weight(1f))
        }

        Column(Modifier.padding(horizontal = 20.dp)) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
            Spacer(Modifier.height(16.dp))
            Kicker(stringResource(R.string.profile_accountSection), color = Theme.fadedSand, size = 9.sp)

            MenuRow("01", Icons.Filled.ConfirmationNumber, stringResource(R.string.profile_myBookings),
                bookingsTotal?.let {
                    if (it == 1) stringResource(R.string.profile_bookingsCountOne, it)
                    else stringResource(R.string.profile_bookingsCount, it)
                } ?: "—") {}
            RowDivider()
            MenuRow("02", Icons.Filled.Bookmark, stringResource(R.string.profile_savedClubs),
                savedCount?.let { stringResource(R.string.profile_savedCount, it) } ?: "—") {}
            RowDivider()
            MenuRow("03", Icons.Filled.People, stringResource(R.string.profile_friends),
                "—", onOpenFriends)
            RowDivider()
            MenuRow("04", Icons.Filled.LocalFireDepartment, stringResource(R.string.explore_points),
                stringResource(R.string.fiamme_balanceSection), onOpenFiamme)

            Spacer(Modifier.height(12.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.ink.copy(alpha = 0.16f)))
            Spacer(Modifier.height(12.dp))
            Kicker(stringResource(R.string.profile_prefsSection), color = Theme.fadedSand, size = 9.sp)

            MenuRow("05", Icons.Filled.Settings, stringResource(R.string.profile_settingsRow),
                stringResource(R.string.profile_settingsSub), onOpenSettings)
            RowDivider()
            MenuRow("06", Icons.AutoMirrored.Filled.HelpOutline, stringResource(R.string.profile_help),
                stringResource(R.string.profile_helpSub)) { uriHandler.openUri(LegalUrls.HELP) }
            RowDivider()
            MenuRow("07", Icons.Filled.Description, stringResource(R.string.profile_terms),
                stringResource(R.string.profile_termsSub)) { uriHandler.openUri(LegalUrls.TERMS) }
            RowDivider()
            MenuRow("08", Icons.Filled.Lock, stringResource(R.string.profile_privacy),
                stringResource(R.string.profile_privacySub)) { uriHandler.openUri(LegalUrls.PRIVACY) }

            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))

            Row(
                Modifier
                    .fillMaxWidth()
                    .clickableUnlessBusy { scope.launch { auth.signOut() } }
                    .padding(vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Logout, null,
                    tint = Theme.wine, modifier = Modifier.size(16.dp),
                )
                Text(
                    stringResource(R.string.settings_signOut).uppercase(),
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold,
                    fontSize = 11.sp, letterSpacing = 2.4.sp, color = Theme.wine,
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * The membership card. Two distinct treatments rather than one recoloured
 * gradient: in light it is gold leaf with DARK type, in dark a near-black base
 * warming into bronze with LIGHT type. Everything inside is a literal colour,
 * because the surface itself flips.
 */
@Composable
private fun IdentityCard(
    first: String,
    last: String,
    initials: String,
    email: String,
    memberYear: String,
    modifier: Modifier = Modifier,
) {
    val isDark = androidx.compose.foundation.isSystemInDarkTheme()
    val goldLeaf = listOf(
        Color(0xFFFCF6E8), Color(0xFFF1E2B8), Color(0xFFE2C57A), Color(0xFFCFA64B),
    )
    val bronzeGlow = listOf(
        Color(0xFF161210), Color(0xFF2C1A0B), Color(0xFF6E4B22),
        Color(0xFF9C6F31), Color(0xFFB5823C),
    )
    val muted = if (isDark) FuocoFixed.parchment.copy(alpha = 0.55f)
    else Color(0xFF2A1F12).copy(alpha = 0.62f)
    val nameColor = if (isDark) FuocoFixed.parchment else Color(0xFF221E1A)
    val surnameColor = if (isDark) Color(0xFFB5823C) else FuocoFixed.darkRed

    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.linearGradient(if (isDark) bronzeGlow else goldLeaf),
            ),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(Modifier.fillMaxWidth()) {
                Kicker("EST. $memberYear", color = muted, size = 8.5.sp)
                Spacer(Modifier.weight(1f))
                Kicker("BARCELONA", color = muted, size = 8.5.sp)
            }
        }

        Column(
            Modifier.padding(start = 20.dp, end = 20.dp, top = 36.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .size(84.dp)
                    .clip(CircleShape)
                    .background(
                        if (isDark) FuocoFixed.parchment.copy(alpha = 0.12f)
                        else Color.White.copy(alpha = 0.55f),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initials,
                    fontFamily = InstrumentSerif,
                    fontStyle = FontStyle.Italic,
                    fontSize = 42.sp,
                    color = if (isDark) FuocoFixed.parchment else FuocoFixed.darkRed,
                )
            }
            Column {
                Text(
                    first.ifEmpty { "—" },
                    fontFamily = InstrumentSerif, fontSize = 36.sp, color = nameColor,
                )
                if (last.isNotEmpty()) {
                    Text(
                        last,
                        fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                        fontSize = 36.sp, color = surnameColor,
                    )
                }
            }
            Text(
                email,
                fontFamily = Geist, fontSize = 10.sp, letterSpacing = 1.2.sp, color = muted,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun Stat(value: Int?, italian: String, caption: String, modifier: Modifier = Modifier) {
    Column(modifier.padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            value?.toString() ?: "—",
            fontFamily = InstrumentSerif, fontSize = 30.sp, color = Theme.accent,
        )
        Text(italian, fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 13.sp, color = Theme.ink)
        Kicker(caption, color = Theme.fadedSand, size = 8.5.sp)
    }
}

@Composable
private fun Divider() {
    Box(Modifier.width(1.dp).height(48.dp).background(Theme.hairline))
}

@Composable
private fun RowDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
}

@Composable
private fun MenuRow(
    n: String,
    icon: ImageVector,
    label: String,
    sub: String,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickableUnlessBusy(onClick = onClick)
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Kicker(n, color = Theme.fadedSand, size = 9.sp)
        Box(
            Modifier.size(32.dp).clip(CircleShape).background(Theme.accent.copy(alpha = 0.08f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = Theme.accent, modifier = Modifier.size(15.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(label, fontFamily = InstrumentSerif, fontSize = 19.sp, color = Theme.ink)
            Text(sub, fontFamily = Geist, fontSize = 11.5.sp, color = Theme.fadedSand)
        }
        Icon(
            Icons.AutoMirrored.Filled.ArrowForward, null,
            tint = Theme.fadedSand, modifier = Modifier.size(14.dp),
        )
    }
}
