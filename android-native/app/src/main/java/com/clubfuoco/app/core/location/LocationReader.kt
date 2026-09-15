package com.clubfuoco.app.core.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * One-shot location reads for attendance. Android counterpart of the parts of
 * iOS's `LocationService` the check-in card actually uses.
 *
 * Deliberately NOT a continuous tracker. The only question the app ever asks is
 * "are you at the venue right now?", asked at the moment someone taps — so there
 * is no stream to subscribe to and nothing to leave running.
 */
object LocationReader {

    /** Foreground location, in either precision. Background is a separate grant. */
    fun hasForegroundPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Whether the precise grant was given, as opposed to approximate only. */
    fun hasPrecisePermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * A fresh fix, or null.
     *
     * `getCurrentLocation` rather than `lastLocation`: a stale cached fix from
     * this morning would happily "check in" someone sitting at home, and the
     * server's distance check is the only thing that would catch it. Asking for
     * a live one is the honest question.
     *
     * Times out rather than hanging — a phone indoors at a venue can take a long
     * while to get a fix, and the card must be able to say so.
     */
    suspend fun current(context: Context, timeoutMs: Long = 12_000): Pair<Double, Double>? {
        if (!hasForegroundPermission(context)) return null

        val client = LocationServices.getFusedLocationProviderClient(context)
        val cancellation = CancellationTokenSource()
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            // Falls back cleanly when only the approximate grant was given —
            // the server checks a radius, not a doorstep.
            .setGranularity(
                if (hasPrecisePermission(context)) Granularity.GRANULARITY_FINE
                else Granularity.GRANULARITY_COARSE,
            )
            .setMaxUpdateAgeMillis(30_000)
            .build()

        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                @Suppress("MissingPermission")
                client.getCurrentLocation(request, cancellation.token)
                    .addOnSuccessListener { location ->
                        cont.resume(location?.let { it.latitude to it.longitude })
                    }
                    .addOnFailureListener { cont.resume(null) }
                cont.invokeOnCancellation { cancellation.cancel() }
            }
        }
    }
}
