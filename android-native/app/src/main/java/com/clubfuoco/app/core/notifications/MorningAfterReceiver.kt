package com.clubfuoco.app.core.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fires the "Did you get in last night?" prompt at 10:00 venue-local the day
 * after a booking. Port of the local-notification half of iOS's
 * NotificationService.
 *
 * iOS schedules these with UNCalendarNotificationTrigger, which the system owns
 * outright. Android has no equivalent: an AlarmManager alarm wakes this
 * receiver, which then posts the notification itself — and alarms do not
 * survive a reboot, which is what BootReceiver exists to repair.
 */
class MorningAfterReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val bookingId = intent.getStringExtra(EXTRA_BOOKING_ID) ?: return
        MorningAfterScheduler.postPrompt(context, bookingId, intent.getStringExtra(EXTRA_VENUE))
    }

    companion object {
        const val EXTRA_BOOKING_ID = "bookingId"
        const val EXTRA_VENUE = "venue"
    }
}
