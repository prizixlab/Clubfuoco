package com.clubfuoco.app.features.auth

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FormError
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.stores.AuthStore
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.util.UUID

/**
 * Social sign-in. Port of `OAuthButtonsView`, with one deliberate platform
 * difference: iOS offers Apple + Google, Android offers Google only — Sign in
 * with Apple exists on Android as a web flow, but Apple only *requires* it
 * alongside other social logins on Apple platforms, and a web-view Apple button
 * here would be worse than not having one.
 *
 * The nonce dance mirrors iOS exactly: a raw nonce goes to Supabase, its SHA-256
 * goes to the identity provider, and GoTrue verifies they match. iOS learned the
 * hard way that letting an SDK pick its own nonce fails that check ("Nonces
 * mismatch") — hence Credential Manager rather than the legacy Google SDK.
 *
 * Requires the Web OAuth client id and the app's SHA-1 registered in Google
 * Cloud; see docs/TESTING.md B2.
 */
@Composable
fun OAuthButtons(
    auth: AuthStore,
    modifier: Modifier = Modifier,
    onNeedsProfile: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.weight(1f).height(1.dp).background(Theme.hairline))
            Text(
                stringResource(R.string.auth_orContinueWith),
                fontFamily = Geist,
                fontSize = 11.sp,
                color = Theme.fadedSand,
            )
            Box(Modifier.weight(1f).height(1.dp).background(Theme.hairline))
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Theme.surface)
                .border(1.dp, Theme.ink.copy(alpha = 0.10f), RoundedCornerShape(12.dp))
                .clickableUnlessBusy(enabled = !busy) {
                    busy = true
                    error = null
                    scope.launch {
                        runCatching { signInWithGoogle(context, auth) }
                            .onSuccess { needsProfile -> if (needsProfile) onNeedsProfile() }
                            .onFailure { error = it.message ?: "Google sign-in failed" }
                        busy = false
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                stringResource(R.string.auth_continueGoogle),
                fontFamily = Geist,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                color = Theme.ink,
            )
        }

        error?.let { FormError(it) }
    }
}

/**
 * Raw nonce → Supabase, SHA-256(nonce) → Google. Returns whether the profile
 * still needs completing.
 */
private suspend fun signInWithGoogle(context: Context, auth: AuthStore): Boolean {
    val rawNonce = UUID.randomUUID().toString()
    val hashedNonce = MessageDigest.getInstance("SHA-256")
        .digest(rawNonce.toByteArray())
        .joinToString("") { "%02x".format(it) }

    val option = GetGoogleIdOption.Builder()
        .setServerClientId(WEB_CLIENT_ID)
        // false so a user with no Google account on the device still gets the
        // full picker rather than a dead end.
        .setFilterByAuthorizedAccounts(false)
        .setNonce(hashedNonce)
        .build()

    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    val response = CredentialManager.create(context).getCredential(context, request)
    val idToken = GoogleIdTokenCredential.createFrom(response.credential.data).idToken

    return auth.signInWithGoogleIdToken(idToken = idToken, rawNonce = rawNonce)
}

/**
 * The WEB OAuth client id — not the Android one. GoTrue validates the token's
 * audience against what is configured in Supabase, which is the web client, and
 * passing the Android client id here fails with an audience mismatch.
 *
 * Same project as the iOS app's GIDClientID.
 */
private const val WEB_CLIENT_ID =
    "170229454537-b4a62382bcnq7ugfckklvv75koih8heo.apps.googleusercontent.com"
