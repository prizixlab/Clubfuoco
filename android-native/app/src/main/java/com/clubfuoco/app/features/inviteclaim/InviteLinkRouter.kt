package com.clubfuoco.app.features.inviteclaim

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Holds the currently-pending invite token so the root can show the claim screen
 * on top of whatever the user was doing. A singleton because deep-link intents
 * arrive at the Activity, outside any composition.
 *
 * Port of `InviteLinkRouter.swift`.
 */
object InviteLinkRouter {

    /** The token from /i/<token>. Cleared when the screen is dismissed. */
    var pendingToken: String? by mutableStateOf(null)

    /**
     * Set when the link came back from Stripe Checkout carrying ?paid=1&guest=.
     *
     * Stripe's success_url is an https://clubfuoco.com/i/<token> URL, so it
     * re-enters the app through the SAME App Link that opened the invite in the
     * first place — and without reading the query the buyer would land back on
     * the join form having just paid, with no sign anything happened. The id
     * only jumps them to their ticket; the webhook is what actually marks the
     * spot paid, so a forged query buys nothing.
     */
    var paidGuestId: String? by mutableStateOf(null)

    /**
     * Returns true when the URI was ours and has been handled, so the caller
     * stops passing it to anything else (the OAuth callback, say).
     *
     * Two shapes to recognise:
     *   1. App Link:       https://clubfuoco.com/i/<token>
     *   2. Custom scheme:  clubfuoco://i/<token>
     *
     * In #2 the token is the first PATH segment, because Uri parses
     * "clubfuoco://i/abc" as scheme=clubfuoco, host=i, path=/abc — exactly the
     * same split iOS has to make.
     */
    fun handle(uri: Uri): Boolean {
        if (uri.scheme == "clubfuoco") {
            if (uri.host != "i") return false
            val raw = uri.pathSegments.firstOrNull().orEmpty()
            if (raw.isEmpty()) return false
            pendingToken = raw
            return true
        }

        val parts = uri.pathSegments.orEmpty()
        if (parts.size < 2 || parts[0] != "i") return false
        val token = parts[1]
        if (token.isEmpty()) return false

        if (uri.getQueryParameter("paid") == "1") {
            paidGuestId = uri.getQueryParameter("guest")
        }
        pendingToken = token
        return true
    }

    fun clear() {
        pendingToken = null
        paidGuestId = null
    }

    /**
     * `https://clubfuoco.com/i/<token>` → `<token>`.
     *
     * Host-checked, because this is also used on strings that did not come from
     * an intent the system verified.
     */
    fun tokenFrom(uri: Uri): String? {
        val host = uri.host?.lowercase() ?: return null
        if (host != "clubfuoco.com" && host != "www.clubfuoco.com") return null
        val parts = uri.pathSegments.orEmpty()
        if (parts.size < 2 || parts[0] != "i") return null
        return parts[1].ifEmpty { null }
    }
}

/**
 * Recovers an invite that was tapped BEFORE the app existed on this phone.
 *
 * An App Link only opens an installed app. Someone who taps /i/<token> without
 * Club Fuoco goes to Play and cold-launches here knowing exactly what they
 * wanted and holding nothing that says so.
 *
 * WHERE THIS DIVERGES FROM iOS, DELIBERATELY: Apple provides no deferred deep
 * link at all, so the iOS app has to read the CLIPBOARD and fall back to a
 * coarse IP-plus-OS-version fingerprint on the server — a guess that can match
 * the wrong person. Android does not need either. Play passes the install
 * referrer through verbatim, so the token arrives EXACTLY, attributed to this
 * install and nobody else. No clipboard read, no paste toast, no fingerprint,
 * no chance of handing someone a stranger's invite.
 *
 * Requires the branded /i/<token> page to send Android visitors to Play with
 * `&referrer=invite%3D<token>` appended — see docs/TESTING.md B8. Until that
 * ships this returns nothing and costs nothing; a guest whose handoff missed
 * still has the link in their messages, and tapping it now works.
 *
 * Runs once per install.
 */
object InviteHandoff {

    private const val PREFS = "cf.invite"
    private const val DONE_KEY = "handoff.checked"

    suspend fun resolveIfNeeded(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(DONE_KEY, false)) return
        prefs.edit { putBoolean(DONE_KEY, true) }

        // Already handled — an App Link fired before we got here, which means
        // the app WAS installed and none of this applies.
        if (InviteLinkRouter.pendingToken != null) return

        tokenFromInstallReferrer(context)?.let { InviteLinkRouter.pendingToken = it }
    }

    /**
     * Reads the Play install referrer and pulls `invite=<token>` out of it.
     *
     * The referrer is a query-string-shaped blob whose other keys belong to
     * whatever campaign tagging is in play, so this parses rather than assuming
     * the whole string is ours.
     */
    private suspend fun tokenFromInstallReferrer(context: Context): String? {
        val referrer = runCatching { readReferrer(context) }.getOrNull() ?: return null
        val token = runCatching {
            Uri.parse("?$referrer").getQueryParameter("invite")
        }.getOrNull()
        return token?.takeIf { it.isNotEmpty() }
    }

    private suspend fun readReferrer(context: Context): String? =
        suspendCancellableCoroutine { cont ->
            val client = InstallReferrerClient.newBuilder(context).build()
            var resumed = false
            fun finish(value: String?) {
                if (resumed) return
                resumed = true
                runCatching { client.endConnection() }
                cont.resume(value)
            }
            client.startConnection(object : InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(responseCode: Int) {
                    if (responseCode != InstallReferrerClient.InstallReferrerResponse.OK) {
                        finish(null)
                        return
                    }
                    finish(runCatching { client.installReferrer.installReferrer }.getOrNull())
                }

                // Play services died mid-handshake. Nothing to retry — the link
                // is still in their messages.
                override fun onInstallReferrerServiceDisconnected() = finish(null)
            })
            cont.invokeOnCancellation { runCatching { client.endConnection() } }
        }
}
