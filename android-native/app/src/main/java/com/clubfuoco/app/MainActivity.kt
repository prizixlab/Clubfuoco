package com.clubfuoco.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.lifecycle.lifecycleScope
import com.clubfuoco.app.app.RootScreen
import com.clubfuoco.app.core.designsystem.ClubFuocoTheme
import com.clubfuoco.app.features.clubdetail.DjPlayer
import com.clubfuoco.app.features.inviteclaim.InviteHandoff
import com.clubfuoco.app.features.inviteclaim.InviteLinkRouter
import com.clubfuoco.app.stores.LocalizedContent
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val env = (application as ClubFuocoApplication).env

        // A cold launch FROM a link arrives in the launch intent; a warm one
        // arrives at onNewIntent. Both routes have to work, because the invite
        // link is how most people meet this app.
        handleIntent(intent)

        // Only after the link in hand has been read: an invite that opened the
        // app directly always wins over a deferred one.
        lifecycleScope.launch { InviteHandoff.resolveIfNeeded(applicationContext) }

        setContent {
            // Appearance and language are BOTH user-controlled in Settings and
            // must take effect without a relaunch, so they wrap the whole tree:
            // the theme provides the palette, LocalizedContent overrides the
            // resource locale for every stringResource beneath it.
            val dark = env.themeStore.isDark(isSystemInDarkTheme())
            val tag = env.localeStore.locale

            ClubFuocoTheme(dark = dark) {
                LocalizedContent(tag = tag) {
                    RootScreen(env = env)
                }
            }
        }
    }

    /**
     * The activity is `singleTask`, so a second link tap re-enters the SAME
     * instance rather than stacking another one — which is what lets the claim
     * screen simply swap tokens instead of piling up.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /**
     * No background playback, by design. Audio runs only while the app is
     * foregrounded, so leaving it stops the preview rather than following the
     * user out of the app.
     */
    override fun onStop() {
        super.onStop()
        DjPlayer.suspend()
    }

    /** The web view is attached to this window, so it cannot outlive it. */
    override fun onDestroy() {
        DjPlayer.close()
        super.onDestroy()
    }

    private fun handleIntent(intent: Intent?) {
        val uri = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data ?: return
        InviteLinkRouter.handle(uri)
    }
}
