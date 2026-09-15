package com.clubfuoco.app.core.notifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.clubfuoco.app.ClubFuocoApplication
import com.clubfuoco.app.MainActivity
import com.clubfuoco.app.R
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Schedules the morning-after attendance prompts. Port of the scheduling half of
 * ios-native's `NotificationService`.
 *
 * At 10:00 Madrid-local on the day AFTER each booking, the device asks "Did you
 * get in?" — tapping it opens the review sheet for that booking. Local, not
 * remote: no server push and no FCM dependency.
 */
object MorningAfterScheduler {

    /** The venue timezone the server reasons in; a booking date is a plain date. */
    private val venueZone: ZoneId = runCatching { ZoneId.of("Europe/Madrid") }
        .getOrElse { ZoneId.systemDefault() }

    /** 10:00 venue-local the day AFTER `bookingDate` ("yyyy-MM-dd"). */
    fun fireTime(bookingDate: String): ZonedDateTime? = runCatching {
        LocalDate.parse(bookingDate)
            .plusDays(1)
            .atTime(LocalTime.of(10, 0))
            .atZone(venueZone)
    }.getOrNull()

    fun schedule(context: Context, bookingId: String, bookingDate: String, venue: String?) {
        val fire = fireTime(bookingDate) ?: return
        if (fire.toInstant().isBefore(java.time.Instant.now())) return

        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        // From API 31 an exact alarm needs permission; without it the prompt
        // would drift by hours, which for a "did you go last night" question is
        // the difference between useful and noise. Fall back rather than crash.
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            alarms.canScheduleExactAlarms()
        val trigger = fire.toInstant().toEpochMilli()

        val pending = pendingIntent(context, bookingId, venue)
        if (canExact) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending)
        } else {
            Log.i(TAG, "no exact-alarm permission; scheduling inexact")
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending)
        }
    }

    fun cancel(context: Context, bookingId: String) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        alarms.cancel(pendingIntent(context, bookingId, null))
    }

    /**
     * Re-arm after a reboot. Alarms are not persisted by the system, so the
     * booking list has to be replayed — wired up with the bookings feature.
     */
    fun rearmAll(context: Context) {
        Log.i(TAG, "boot: morning-after alarms need re-arming")
    }

    fun postPrompt(context: Context, bookingId: String, venue: String?) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return

        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MorningAfterReceiver.EXTRA_BOOKING_ID, bookingId)
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            bookingId.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val body = context.getString(R.string.review_promptBody, venue ?: "")
        val notification = NotificationCompat.Builder(context, ClubFuocoApplication.CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.review_promptTitle))
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()

        runCatching { manager.notify(bookingId.hashCode(), notification) }
    }

    private fun pendingIntent(context: Context, bookingId: String, venue: String?): PendingIntent {
        val intent = Intent(context, MorningAfterReceiver::class.java).apply {
            putExtra(MorningAfterReceiver.EXTRA_BOOKING_ID, bookingId)
            putExtra(MorningAfterReceiver.EXTRA_VENUE, venue)
        }
        return PendingIntent.getBroadcast(
            context,
            bookingId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private const val TAG = "MorningAfter"
}
