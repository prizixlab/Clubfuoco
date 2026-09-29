package com.clubfuoco.app.features.bookings

import android.Manifest
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.location.LocationReader
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.network.ApiException
import com.clubfuoco.app.models.Booking
import com.clubfuoco.app.models.Hours
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/**
 * "I'm here", and afterwards "did you get in?" — the user-facing half of the
 * attendance verification system.
 *
 * Three states, driven by the clock against the booking's window and the
 * rolled-up `attendance_status` on the row:
 *
 *  1. Before the window → nothing at all.
 *  2. Inside it        → "I'm here", which reads location once and posts a
 *                        `user_checkin`.
 *  3. After it         → "Did you get in?" with the two answers.
 *
 * Once anything positive has been recorded the card collapses to a quiet
 * confirmation. Port of `AttendanceCheckInCard`.
 */
private enum class Phase { PRE_WINDOW, CHECK_IN_OPEN, POST_WINDOW, CONFIRMED, HIDDEN }

/** The reasons someone can give for not getting in, as the API spells them. */
private val ISSUE_REASONS = listOf(
    "denied" to R.string.attend_reasonDenied,
    "not_on_list" to R.string.attend_reasonNotOnList,
    "arrived_late" to R.string.attend_reasonLate,
    "dress_code" to R.string.attend_reasonDressCode,
    "at_capacity" to R.string.attend_reasonCapacity,
    "did_not_go" to R.string.attend_reasonDidNotGo,
    "other" to R.string.attend_reasonOther,
)

@Composable
fun AttendanceCheckInCard(
    booking: Booking,
    api: ApiClient,
    onSignalPosted: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var posting by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var showIssues by remember { mutableStateOf(false) }

    val phase = remember(booking) { phaseFor(booking) }
    if (phase == Phase.HIDDEN || phase == Phase.PRE_WINDOW) return

    // Hoisted: stringResource is composable and cannot be read inside a handler.
    val noLocation = stringResource(R.string.attend_noLocation)
    val tooFar = stringResource(R.string.attend_tooFar)
    val notOpenYet = stringResource(R.string.attend_notOpenYet)
    val noVenueLocation = stringResource(R.string.attend_noVenueLocation)
    val genericFailure = stringResource(R.string.review_saveFailed)
    val checkedIn = stringResource(R.string.attend_checkedIn)
    val noted = stringResource(R.string.attend_noted)
    val sorryToHear = stringResource(R.string.attend_sorryToHear)

    fun send(kind: String, reason: String? = null) {
        if (posting) return
        posting = true
        feedback = null
        scope.launch {
            var lat: Double? = null
            var lng: Double? = null

            if (kind == "user_checkin") {
                val fix = LocationReader.current(context)
                if (fix == null) {
                    feedback = noLocation
                    posting = false
                    return@launch
                }
                lat = fix.first
                lng = fix.second
            }

            val result = runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/bookings/${booking.id}/signals",
                        SignalResponse.serializer(),
                        Json.encodeToString(
                            SignalRequest.serializer(),
                            SignalRequest(kind, lat, lng, reason),
                        ),
                    )
                }
            }

            result.onSuccess {
                feedback = when (kind) {
                    "user_checkin" -> checkedIn
                    "post_entry_got_in" -> noted
                    else -> sorryToHear
                }
                onSignalPosted()
            }.onFailure { error ->
                // The server's refusals are specific and worth repeating in the
                // guest's own terms — "you're too far" is actionable, "request
                // failed" is not.
                val raw = (error as? ApiException.Http)?.message.orEmpty().lowercase()
                feedback = when {
                    raw.contains("too far") -> tooFar
                    raw.contains("outside booking window") -> notOpenYet
                    raw.contains("venue location") -> noVenueLocation
                    else -> genericFailure
                }
            }
            posting = false
        }
    }

    // Asking is what makes "I'm here" work at all; the tap is the moment it
    // makes sense to the person seeing the prompt.
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        if (granted.values.any { it }) send("user_checkin")
    }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .border(
                1.dp,
                Theme.wine.copy(alpha = if (phase == Phase.CONFIRMED) 0.5f else 0.2f),
                RoundedCornerShape(14.dp),
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            stringResource(
                if (phase == Phase.POST_WINDOW) R.string.attend_kickerAfter
                else R.string.attend_kicker,
            ).uppercase(),
            fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
            color = Theme.wine.copy(alpha = 0.7f),
        )
        Text(
            when (phase) {
                Phase.CHECK_IN_OPEN -> stringResource(R.string.attend_nearby)
                Phase.POST_WINDOW -> stringResource(R.string.attend_didYouGetIn)
                else -> stringResource(confirmedTitle(booking.attendanceStatus))
            },
            fontFamily = InstrumentSerif, fontSize = 20.sp, color = Theme.ink,
        )
        Text(
            when (phase) {
                Phase.CHECK_IN_OPEN -> stringResource(R.string.attend_nearbyNote)
                Phase.POST_WINDOW -> stringResource(R.string.attend_didYouGetInNote)
                else -> stringResource(confirmedSubtitle(booking.attendanceStatus))
            },
            fontFamily = Geist, fontSize = 12.5.sp, color = Theme.stone,
        )

        when {
            showIssues -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    stringResource(R.string.attend_whatHappened),
                    fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 13.sp,
                    color = Theme.ink,
                )
                ISSUE_REASONS.forEach { (value, labelRes) ->
                    OutlineButton(stringResource(labelRes), enabled = !posting) {
                        showIssues = false
                        send("post_entry_issue", value)
                    }
                }
                OutlineButton(stringResource(R.string.common_cancel), enabled = !posting) {
                    showIssues = false
                }
            }

            phase == Phase.CHECK_IN_OPEN -> Row(
                Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Theme.wine)
                    .clickableUnlessBusy(enabled = !posting) {
                        if (LocationReader.hasForegroundPermission(context)) {
                            send("user_checkin")
                        } else {
                            permissionLauncher.launch(
                                arrayOf(
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION,
                                ),
                            )
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            ) {
                Icon(
                    Icons.Filled.LocationOn, contentDescription = null,
                    tint = Theme.cream, modifier = Modifier.size(16.dp),
                )
                Text(
                    stringResource(
                        if (posting) R.string.attend_checkingIn else R.string.attend_imHere,
                    ),
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    color = Theme.cream,
                )
            }

            phase == Phase.POST_WINDOW -> Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                EntryButton(
                    label = stringResource(R.string.attend_gotIn),
                    icon = Icons.Filled.Check,
                    enabled = !posting,
                    modifier = Modifier.weight(1f),
                ) { send("post_entry_got_in") }
                EntryButton(
                    label = stringResource(R.string.attend_hadAnIssue),
                    icon = Icons.Filled.WarningAmber,
                    enabled = !posting,
                    modifier = Modifier.weight(1f),
                ) { showIssues = true }
            }
        }

        feedback?.let {
            Text(it, fontFamily = Geist, fontSize = 12.sp, color = Theme.wine)
        }
    }
}

@Composable
private fun EntryButton(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier
            .height(44.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(Theme.surface)
            .border(1.dp, Theme.hairline, RoundedCornerShape(11.dp))
            .clickableUnlessBusy(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        Icon(icon, contentDescription = null, tint = Theme.ink, modifier = Modifier.size(14.dp))
        Text(
            label,
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 13.sp,
            color = Theme.ink,
        )
    }
}

@Composable
private fun OutlineButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(42.dp)
            .clip(RoundedCornerShape(11.dp))
            .border(1.dp, Theme.hairline, RoundedCornerShape(11.dp))
            .clickableUnlessBusy(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontFamily = Geist, fontSize = 13.sp, color = Theme.ink)
    }
}

// ── State machine ────────────────────────────────────────────────────────────

/** Attendance states that already have an answer one way or the other. */
private val RESOLVED = setOf(
    "verified_attended", "likely_attended", "user_claimed_attended", "no_show", "disputed",
)

private fun phaseFor(booking: Booking): Phase {
    if (booking.status == "cancelled") return Phase.HIDDEN
    if (booking.attendanceStatus.orEmpty() in RESOLVED) return Phase.CONFIRMED

    val zone = ZoneId.of("Europe/Madrid")
    val now = LocalDateTime.now(zone)
    val (earliest, checkInUntil) = windowFor(booking) ?: return Phase.HIDDEN
    // A short tail for the "did you get in?" question — long enough to catch
    // someone on the way home, short enough that it is not still asking days
    // later about a night they have stopped thinking about.
    val postCutoff = checkInUntil.plusHours(2)

    return when {
        now.isBefore(earliest) -> Phase.PRE_WINDOW
        !now.isAfter(checkInUntil) -> Phase.CHECK_IN_OPEN
        !now.isAfter(postCutoff) -> Phase.POST_WINDOW
        else -> Phase.HIDDEN
    }
}

/**
 * The attendance window, anchored to the club's hours for that night:
 *  - opens at the club's opening time,
 *  - closes at the club's closing time, OR at cutoff + 3h for a time-boxed
 *    invitation like the rumba list.
 */
private fun windowFor(booking: Booking): Pair<LocalDateTime, LocalDateTime>? {
    val day = runCatching { LocalDate.parse(booking.bookingDate) }.getOrNull() ?: return null
    val window = Hours.nightWindow(booking.bookingDate, booking.club?.openingHours.orEmpty())

    val earliest = day.atStartOfDay().plusMinutes(window.openMin.toLong())
    var checkInUntil = day.atStartOfDay().plusMinutes(window.closeMin.toLong())
    if (window.closesNextDay) checkInUntil = checkInUntil.plusDays(1)

    booking.cutoffTime
        ?.let { runCatching { LocalTime.parse(it.take(5)) }.getOrNull() }
        ?.let { cutoff ->
            // Cutoffs almost always sit after midnight (01:30 and the like), so
            // one landing before opening belongs to the next day.
            val at = day.atTime(cutoff)
            val adjusted = if (at.isBefore(earliest)) at.plusDays(1) else at
            checkInUntil = adjusted.plusHours(3)
        }

    return earliest to checkInUntil
}

private fun confirmedTitle(status: String?): Int = when (status) {
    "verified_attended" -> R.string.attend_confirmedThere
    "likely_attended" -> R.string.attend_checkedInTitle
    "user_claimed_attended" -> R.string.attend_gotItThanks
    "no_show" -> R.string.attend_markedNoShow
    else -> R.string.attend_lookingInto
}

private fun confirmedSubtitle(status: String?): Int = when (status) {
    "disputed" -> R.string.attend_supportFollowUp
    "no_show" -> R.string.attend_noShowWrong
    else -> R.string.attend_noAction
}

// ── Wire payloads ────────────────────────────────────────────────────────────

@Serializable
private data class SignalRequest(
    val kind: String,
    val lat: Double? = null,
    val lng: Double? = null,
    val reason: String? = null,
)

@Serializable
private data class SignalResponse(
    val logged: String? = null,
    @kotlinx.serialization.SerialName("distance_m") val distanceM: Int? = null,
)

/** Unused here but kept beside the card: the passive signal the detail fires. */
internal suspend fun firePassViewed(context: Context, booking: Booking, api: ApiClient) {
    // Silent and best-effort: never prompts for location, only piggy-backs on a
    // grant the user already gave. Confidence climbing without a tap is the
    // whole point, so a failure here is not worth surfacing.
    if (!LocationReader.hasForegroundPermission(context)) return
    val fix = LocationReader.current(context, timeoutMs = 6_000) ?: return
    runCatching {
        withContext(Dispatchers.IO) {
            api.post(
                "/api/bookings/${booking.id}/signals",
                SignalResponse.serializer(),
                Json.encodeToString(
                    SignalRequest.serializer(),
                    SignalRequest("pass_viewed", fix.first, fix.second),
                ),
            )
        }
    }
}
