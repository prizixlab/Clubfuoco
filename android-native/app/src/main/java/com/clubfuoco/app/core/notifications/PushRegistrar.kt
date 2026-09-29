package com.clubfuoco.app.core.notifications

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.clubfuoco.app.ClubFuocoApplication
import com.clubfuoco.app.MainActivity
import com.clubfuoco.app.R
import com.clubfuoco.app.core.supabase.SupabaseService
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * Remote-push registration. Port of ios-native's `PushRegistrar`, with two bugs
 * from that version deliberately not carried over:
 *
 *  1. iOS asks for the token from a `.task` that runs once per launch, while the
 *     user is still signed out on a fresh install — the upload then finds no
 *     session and silently no-ops, so push does not work until the SECOND cold
 *     launch. Here [onSignedIn] re-runs the upload the moment a session exists.
 *
 *  2. iOS has a `reset()` that is never called, so a device that changes hands
 *     keeps pushing to the previous user. [onSignedOut] actually deletes the
 *     row.
 *
 * Everything is best-effort: a failure anywhere (no google-services.json, no
 * network, table missing) leaves the rest of the app untouched.
 */
object PushRegistrar {

    private var lastUploadedToken: String? = null
    private var supabase: SupabaseService? = null

    fun attach(service: SupabaseService) {
        supabase = service
    }

    /** FCM handed us a token. */
    fun onNewToken(context: Context, token: String) {
        CoroutineScope(Dispatchers.IO).launch { upload(token) }
    }

    /**
     * A session now exists. Re-uploads the cached token — this is the call the
     * iOS app is missing.
     */
    fun onSignedIn() {
        val token = lastKnownToken ?: return
        CoroutineScope(Dispatchers.IO).launch { upload(token, force = true) }
    }

    /** Unbind this device from the user who just signed out. */
    fun onSignedOut() {
        val token = lastKnownToken ?: return
        val service = supabase ?: return
        lastUploadedToken = null
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                service.client.postgrest.from("device_tokens")
                    .delete { filter { eq("token", token) } }
            }
        }
    }

    /** Cached separately from [lastUploadedToken] so a re-upload is possible. */
    private var lastKnownToken: String? = null

    private suspend fun upload(token: String, force: Boolean = false) {
        lastKnownToken = token
        val service = supabase ?: return
        if (!force && token == lastUploadedToken) return
        val userId = service.currentUserId() ?: return

        val row = DeviceToken(
            userId = userId,
            token = token,
            platform = "android",
            // Must match device_tokens.app on the server: consumer and promoter
            // tokens are addressed separately, and FCM rejects a push whose
            // target does not own the token.
            app = "clubfuoco",
            environment = "production",
            updatedAt = Instant.now().toString(),
        )

        runCatching {
            service.client.postgrest.from("device_tokens")
                .upsert(row) { onConflict = "token" }
            lastUploadedToken = token
        }.onFailure {
            // Never surfaced: push is an enhancement, not a requirement.
            Log.w(TAG, "device token upload failed: ${it.message}")
        }
    }

    /** Renders a data push that arrived while the app was foregrounded. */
    fun showRemote(context: Context, title: String, body: String, data: Map<String, String>) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return

        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            data.forEach { (k, v) -> putExtra(k, v) }
        }
        val id = (data["id"] ?: title).hashCode()
        val contentIntent = PendingIntent.getActivity(
            context, id, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, ClubFuocoApplication.CHANNEL_SOCIAL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()

        runCatching { manager.notify(id, notification) }
    }

    @Serializable
    private data class DeviceToken(
        @SerialName("user_id") val userId: String,
        val token: String,
        val platform: String,
        val app: String,
        val environment: String,
        @SerialName("updated_at") val updatedAt: String,
    )

    private const val TAG = "PushRegistrar"
}
