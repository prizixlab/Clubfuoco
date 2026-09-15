package com.clubfuoco.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.clubfuoco.app.app.AppEnvironment

class ClubFuocoApplication : Application() {

    lateinit var env: AppEnvironment
        private set

    override fun onCreate() {
        super.onCreate()
        env = AppEnvironment(this)
        registerNotificationChannels()
    }

    /**
     * Channels must exist before the first notification is posted, and they are
     * permanent once created — renaming a channel id orphans the user's
     * per-channel settings. iOS has no equivalent; this is the one place the
     * notification model genuinely differs.
     */
    private fun registerNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_REMINDERS,
                getString(R.string.channel_reminders),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = getString(R.string.channel_reminders_desc) },
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_SOCIAL,
                getString(R.string.channel_social),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = getString(R.string.channel_social_desc) },
        )
    }

    companion object {
        /** Morning-after review prompts and booking reminders. */
        const val CHANNEL_REMINDERS = "cf.reminders"

        /** Friend requests, group invites, RSVPs. */
        const val CHANNEL_SOCIAL = "cf.social"
    }
}
