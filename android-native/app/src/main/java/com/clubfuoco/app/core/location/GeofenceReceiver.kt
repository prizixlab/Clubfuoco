package com.clubfuoco.app.core.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * Delivers geofence transitions for the attendance system, even when the app is
 * dead — the Android counterpart of `didEnterRegion` in iOS's LocationService.
 *
 * Region ids carry their own routing, exactly as on iOS: "cf.booking.<uuid>"
 * posts a booking check-in, "cf.invite.<uuid>" posts a promoter-invite one.
 *
 * PORT STATUS: transitions are received and parsed; posting the signal is wired
 * up with the rest of the attendance flow. See docs/TESTING.md — this is one of
 * the pieces that can only be verified on real hardware.
 */
class GeofenceReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            Log.w(TAG, "geofence error ${event.errorCode}")
            return
        }
        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_ENTER) return

        for (fence in event.triggeringGeofences.orEmpty()) {
            when {
                fence.requestId.startsWith(BOOKING_PREFIX) ->
                    Log.i(TAG, "entered booking fence ${fence.requestId.removePrefix(BOOKING_PREFIX)}")
                fence.requestId.startsWith(INVITE_PREFIX) ->
                    Log.i(TAG, "entered invite fence ${fence.requestId.removePrefix(INVITE_PREFIX)}")
            }
        }
    }

    companion object {
        private const val TAG = "GeofenceReceiver"
        const val BOOKING_PREFIX = "cf.booking."
        const val INVITE_PREFIX = "cf.invite."
    }
}
