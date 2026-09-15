package com.clubfuoco.app.app

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.ShimmerBlock
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.features.auth.AuthFlow
import com.clubfuoco.app.features.auth.CompleteProfileScreen
import com.clubfuoco.app.features.inviteclaim.InviteClaimScreen
import com.clubfuoco.app.features.inviteclaim.InviteLinkRouter
import com.clubfuoco.app.features.main.MainTabs
import com.clubfuoco.app.stores.AuthStore

/**
 * Port of `RootView`: decides between the boot splash, the complete-profile
 * gate, the auth flow and the main tab shell.
 *
 * The ordering of these branches is load-bearing and matches iOS exactly:
 *
 *  - The complete-profile gate comes BEFORE the auth-flow check, because an
 *    existing session whose row is missing a required field (gender, added
 *    2026-06-22) has to be stopped before it reaches the tabs.
 *  - It is skipped while `onboardingInProgress`, because the signup wizard signs
 *    the user in partway through and would otherwise be yanked out of its own
 *    remaining steps.
 */
@Composable
fun RootScreen(env: AppEnvironment) {
    val auth = env.authStore

    when {
        auth.state == AuthStore.State.LOADING -> SplashScreen()

        auth.state == AuthStore.State.SIGNED_IN &&
            !auth.onboardingInProgress &&
            auth.profile?.isComplete != true -> CompleteProfileScreen(auth)

        auth.onboardingInProgress ||
            (auth.state == AuthStore.State.SIGNED_OUT && !auth.guestMode) ->
            AuthFlow(auth, env.api)

        else -> MainTabs(env)
    }

    // A tapped invite covers EVERYTHING above, including the auth flow.
    //
    // That is the whole funnel: someone who installed the app because a friend
    // put them on a list should land on the list, not on a signup wizard. The
    // claim endpoint accepts anonymous callers, and the account offer comes
    // afterwards, on the ticket, once the spot is already theirs.
    InviteLinkRouter.pendingToken?.let { token ->
        InviteClaimScreen(
            token = token,
            auth = auth,
            api = env.api,
            preclaimedGuestId = InviteLinkRouter.paidGuestId,
            onClose = { InviteLinkRouter.clear() },
        )
    }
}

/**
 * Boot skeleton — cream background + ghost cards mirroring the explore feed, so
 * the transition into the loaded app doesn't flash a dark wordmark. Direct port
 * of `SplashView`, built on the shared [ShimmerBlock] primitive.
 */
@Composable
fun SplashScreen() {
    Box(
        Modifier
            .fillMaxSize()
            .background(Theme.cream),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp)
                .padding(top = 60.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                ShimmerBlock(Modifier.width(130.dp).height(22.dp), corner = 4.dp)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    repeat(3) {
                        ShimmerBlock(Modifier.width(78.dp).height(30.dp), corner = 15.dp)
                    }
                }
            }

            Box(Modifier.fillMaxWidth().height(220.dp)) {
                ShimmerBlock(Modifier.fillMaxSize(), corner = 18.dp)
                Column(
                    Modifier.align(Alignment.BottomStart).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    ShimmerBlock(Modifier.width(80.dp).height(10.dp), corner = 4.dp)
                    ShimmerBlock(Modifier.width(220.dp).height(22.dp), corner = 4.dp)
                    ShimmerBlock(Modifier.width(160.dp).height(18.dp), corner = 4.dp)
                }
            }

            repeat(3) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Theme.surface.copy(alpha = 0.55f))
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ShimmerBlock(Modifier.size(72.dp), corner = 12.dp)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        ShimmerBlock(Modifier.width(180.dp).height(16.dp), corner = 4.dp)
                        ShimmerBlock(Modifier.width(120.dp).height(12.dp), corner = 4.dp)
                        ShimmerBlock(Modifier.width(80.dp).height(10.dp), corner = 4.dp)
                    }
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

/** Temporary — replaced when the tab shell lands. */
@Composable
private fun PortPlaceholder(state: String) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Theme.cream),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "fuoco.",
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 40.sp,
                color = Theme.ink,
            )
            Text(state, fontFamily = Geist, fontSize = 12.sp, color = Theme.fadedSand)
        }
    }
}
