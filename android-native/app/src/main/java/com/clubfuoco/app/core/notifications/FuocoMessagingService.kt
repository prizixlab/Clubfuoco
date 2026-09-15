package com.clubfuoco.app.core.notifications

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Remote push. The Android counterpart of the APNs half of iOS's PushRegistrar —
 * the token is stored per (user, app) in `device_tokens` so the server can
 * address the right client, exactly as the consumer/promoter split requires
 * there.
 *
 * Everything here is best-effort: the in-app notifications list is the durable
 * record and push is delivery on top of it.
 *
 * Inert until app/google-services.json exists; see docs/TESTING.md.
 */
class FuocoMessagingService : FirebaseMessagingService() {

    // Firebase has deprecated this in favour of its newer token API, but the
    // replacement is not available on the messaging artifact we depend on.
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onNewToken(token: String) {
        Log.i(TAG, "new FCM token")
        PushRegistrar.onNewToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        PushRegistrar.showRemote(
            context = applicationContext,
            title = notification.title.orEmpty(),
            body = notification.body.orEmpty(),
            data = message.data,
        )
    }

    private companion object {
        const val TAG = "FuocoMessaging"
    }
}
