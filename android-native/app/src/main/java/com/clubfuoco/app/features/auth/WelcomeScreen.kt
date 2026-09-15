package com.clubfuoco.app.features.auth

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
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.LegalUrls
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.FuocoRadius
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.stores.AuthStore
import kotlinx.coroutines.launch

/**
 * Port of the dark cinema splash (`WelcomeView` / _native/Splash.tsx) — the fire
 * glow and the three peer CTAs.
 *
 * "Continue as guest" MUST stay a peer button, visually equal to the other two.
 * App Review rejected a build where it read as a footnote (guideline 5.1.1(v)),
 * and Play takes the same dim view of walling a browsable catalogue.
 */
@Composable
fun WelcomeScreen(
    auth: AuthStore,
    onSignUp: () -> Unit,
    onSignIn: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    var continuing by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(FuocoFixed.night)) {
        // The fire glow sits in the background layer so its oversized canvas
        // cannot inflate the layout width — on iOS it clipped the footer text
        // when it lived directly in the stack.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colorStops = arrayOf(
                            0.00f to Theme.flame.copy(alpha = 0.55f),
                            0.22f to Theme.ember.copy(alpha = 0.42f),
                            0.42f to FuocoFixed.darkRed.copy(alpha = 0.32f),
                            0.62f to Color.Transparent,
                        ),
                        center = Offset.Unspecified,
                        radius = 1000f,
                    ),
                ),
        )

        Column(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Kicker(
                "EST · MMXXVI · BARCELONA",
                color = FuocoFixed.parchment.copy(alpha = 0.6f),
                modifier = Modifier.padding(top = 24.dp),
            )

            Spacer(Modifier.weight(1f))

            Kicker(
                "N° 01 · BARCELONA",
                color = FuocoFixed.parchment.copy(alpha = 0.45f),
                size = 9.sp,
                modifier = Modifier.padding(bottom = 20.dp),
            )

            Text(
                "CLUB FUOCO",
                fontFamily = InstrumentSerif,
                fontSize = 34.sp,
                // Trailing kern is compensated with a leading pad so the
                // wordmark optically centres.
                letterSpacing = 10.9.sp,
                color = FuocoFixed.parchment,
                modifier = Modifier.padding(start = 10.9.dp, bottom = 16.dp),
            )

            Text(
                stringResource(R.string.splash_tagline),
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 20.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.75f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 48.dp),
            )

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SplashButton(stringResource(R.string.splash_createAccount), prominent = true) {
                    onSignUp()
                }
                SplashButton(stringResource(R.string.splash_signIn)) { onSignIn() }
                SplashButton(
                    if (continuing) stringResource(R.string.splash_opening)
                    else stringResource(R.string.splash_continueGuest),
                ) {
                    if (!continuing) {
                        continuing = true
                        scope.launch { auth.signInAsGuest() }
                    }
                }

                Text(
                    stringResource(R.string.splash_guestNote),
                    fontFamily = Geist,
                    fontStyle = FontStyle.Italic,
                    fontSize = 12.sp,
                    color = FuocoFixed.parchment.copy(alpha = 0.55f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                )
            }

            Column(
                Modifier.padding(top = 24.dp, bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Kicker(
                    stringResource(R.string.splash_termsNote),
                    color = FuocoFixed.parchment.copy(alpha = 0.4f),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    LegalLink(stringResource(R.string.signup_termsOfUse)) {
                        uriHandler.openUri(LegalUrls.TERMS)
                    }
                    Text("·", color = FuocoFixed.parchment.copy(alpha = 0.3f), fontFamily = Geist)
                    LegalLink(stringResource(R.string.signup_privacyPolicy)) {
                        uriHandler.openUri(LegalUrls.PRIVACY)
                    }
                }
            }
        }
    }
}

@Composable
private fun SplashButton(
    title: String,
    prominent: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(55.dp)
            .clip(RoundedCornerShape(FuocoRadius.field))
            .background(
                if (prominent) Theme.ember else FuocoFixed.emberCream.copy(alpha = 0.06f),
            )
            .then(
                if (prominent) Modifier
                else Modifier.border(
                    1.dp,
                    FuocoFixed.parchment.copy(alpha = 0.22f),
                    RoundedCornerShape(FuocoRadius.field),
                ),
            )
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            fontFamily = Geist,
            fontWeight = if (prominent) FontWeight.Medium else FontWeight.Normal,
            fontSize = 15.sp,
            color = if (prominent) FuocoFixed.emberCream else FuocoFixed.parchment,
        )
    }
}

@Composable
private fun LegalLink(text: String, onClick: () -> Unit) {
    Text(
        text,
        fontFamily = Geist,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        color = FuocoFixed.parchment.copy(alpha = 0.75f),
        modifier = Modifier.clickableUnlessBusy(onClick = onClick),
    )
}
