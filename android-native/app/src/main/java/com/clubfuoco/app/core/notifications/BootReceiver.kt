package com.clubfuoco.app.core.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * AlarmManager drops every scheduled alarm on reboot, so the morning-after
 * prompts have to be re-armed. This has no iOS counterpart — UNUserNotification
 * requests survive restarts on their own.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        MorningAfterScheduler.rearmAll(context)
    }
}
