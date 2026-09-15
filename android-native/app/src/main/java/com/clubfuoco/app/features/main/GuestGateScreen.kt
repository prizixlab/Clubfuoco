package com.clubfuoco.app.features.main

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.PersonAddAlt1
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoRadius
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.stores.AuthStore

/**
 * Shown in place of account-required surfaces (Tickets, You) and when a guest
 * reaches for an account action. Port of `GuestGateView`.
 *
 * Browsing stays open; only account actions are gated. This view must never
 * stand between someone and the catalogue.
 *
 * It takes a [reason] so the gate names the thing the person was actually
 * reaching for. A gate that says "Sign in" asks for a favour; one that says
 * "Keep this venue" finishes the job they started.
 */
enum class GateReason(
    val icon: ImageVector,
    val titleKey: String,
    val bodyKey: String,
) {
    SAVE(Icons.Filled.Bookmark, "gate_saveTitle", "gate_saveBody"),
    GUESTLIST(Icons.AutoMirrored.Filled.ListAlt, "gate_guestlistTitle", "gate_guestlistBody"),
    TICKETS(Icons.Filled.ConfirmationNumber, "gate_ticketsTitle", "gate_ticketsBody"),
    ACCOUNT(Icons.Filled.PersonAddAlt1, "gate_accountTitle", "gate_accountBody"),
    GENERIC(Icons.Filled.PersonAddAlt1, "gate_title", "splash_guestNote"),
}

@Composable
fun GuestGateScreen(reason: GateReason, auth: AuthStore) {
    val context = androidx.compose.ui.platform.LocalContext.current
    fun str(key: String): String {
        val id = context.resources.getIdentifier(key, "string", context.packageName)
        return if (id != 0) context.getString(id) else key
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            reason.icon,
            contentDescription = null,
            tint = Theme.sand,
            modifier = Modifier.size(40.dp).padding(bottom = 16.dp),
        )
        Text(
            str(reason.titleKey),
            fontFamily = InstrumentSerif,
            fontSize = 24.sp,
            color = Theme.ink,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 16.dp),
        )
        Text(
            str(reason.bodyKey),
            fontFamily = Geist,
            fontSize = 13.sp,
            color = Theme.stone,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 24.dp),
        )

        PrimaryButton(
            title = stringResource(R.string.splash_createAccount),
            background = Theme.ember,
        ) { auth.exitGuestMode() }

        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 10.dp)
                .height(48.dp)
                .border(1.dp, Theme.hairline, RoundedCornerShape(FuocoRadius.field))
                .clickableUnlessBusy { auth.exitGuestMode() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                stringResource(R.string.splash_signIn),
                fontFamily = Geist,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                color = Theme.ink,
            )
        }

        // Browsing is never the thing being gated — say so, so the sheet reads
        // as an offer rather than a wall.
        Text(
            stringResource(R.string.gate_keepBrowsing).uppercase(),
            fontFamily = GeistMono,
            fontSize = 9.sp,
            letterSpacing = 0.8.sp,
            color = Theme.fadedSand,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 16.dp),
        )
    }
}
