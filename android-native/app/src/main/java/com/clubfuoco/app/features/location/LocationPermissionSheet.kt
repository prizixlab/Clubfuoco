package com.clubfuoco.app.features.location

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.location.LocationReader

/**
 * Two-mode pre-prompt for Android's location ladder.
 *
 *  - [Mode.NEARBY]  — the first time Explore opens. Foreground only: "see the
 *                     clubs closest to you tonight". One system dialog, so one
 *                     highlighted tip rather than a step list.
 *  - [Mode.ARRIVAL] — after a booking is confirmed. Asks for background access
 *                     so a geofence can update the pass on the night.
 *
 * WHERE ANDROID DIFFERS FROM iOS, AND WHY THE COPY IS SEPARATE: iOS shows a
 * second "Change to Always Allow" dialog in the app. Android does not — from
 * API 30 the background grant can only be given in Settings, and the system
 * dialog's job is just to send the user there. So the arrival flow here goes
 * foreground dialog → Settings, and the steps name Android's own wording
 * ("Allow all the time"), not Apple's.
 */
enum class LocationMode { NEARBY, ARRIVAL }

@Composable
fun LocationPermissionSheet(mode: LocationMode, onClose: () -> Unit) {
    val context = LocalContext.current
    var showSettingsStep by remember { mutableStateOf(false) }
    var requesting by remember { mutableStateOf(false) }

    val foregroundLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        requesting = false
        when {
            granted.values.none { it } -> onClose()
            mode == LocationMode.NEARBY -> onClose()
            // Foreground is in hand; the background grant lives in Settings.
            needsSettingsForBackground() -> showSettingsStep = true
            else -> onClose()
        }
    }

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Box(
                Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(Theme.wine.copy(alpha = 0.08f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.LocationOn,
                    contentDescription = null,
                    tint = Theme.wine,
                    modifier = Modifier.size(30.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Filled.Close,
                contentDescription = stringResource(R.string.common_close),
                tint = Theme.stone,
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .clickableUnlessBusy(onClick = onClose)
                    .padding(9.dp),
            )
        }

        Text(
            stringResource(
                when {
                    mode == LocationMode.NEARBY -> R.string.location_nearby_title
                    showSettingsStep -> R.string.location_settingsTitle
                    else -> R.string.location_title
                },
            ),
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 32.sp, lineHeight = 36.sp, color = Theme.ink,
        )

        Text(
            stringResource(
                when {
                    mode == LocationMode.NEARBY -> R.string.location_nearby_body
                    showSettingsStep -> R.string.location_androidSettingsBody
                    else -> R.string.location_body
                },
            ),
            fontFamily = Geist, fontSize = 14.sp, lineHeight = 21.sp, color = Theme.stone,
        )

        // The callout: one highlighted tip for the single dialog, a numbered
        // list for the Settings walk.
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(Theme.surface.copy(alpha = 0.6f))
                .border(1.dp, Theme.hairline, RoundedCornerShape(14.dp))
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            when {
                mode == LocationMode.NEARBY -> StepRow(
                    marker = { TipIcon() },
                    text = emphasised(stringResource(R.string.location_androidNearbyTip)),
                )

                showSettingsStep -> {
                    listOf(
                        R.string.location_androidSettingsStep1,
                        R.string.location_androidSettingsStep2,
                        R.string.location_androidSettingsStep3,
                    ).forEachIndexed { index, res ->
                        StepRow(
                            marker = { NumberMarker(index + 1) },
                            text = emphasised(stringResource(res)),
                        )
                    }
                }

                else -> {
                    Text(
                        stringResource(R.string.location_stepsHeader).uppercase(),
                        fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 1.4.sp,
                        color = Theme.fadedSand,
                    )
                    listOf(
                        R.string.location_androidStep1,
                        R.string.location_androidStep2,
                    ).forEachIndexed { index, res ->
                        StepRow(
                            marker = { NumberMarker(index + 1) },
                            text = emphasised(stringResource(res)),
                        )
                    }
                }
            }
        }

        Spacer(Modifier.weight(1f))

        PrimaryButton(
            title = stringResource(
                when {
                    mode == LocationMode.NEARBY -> R.string.location_nearby_enable
                    showSettingsStep -> R.string.location_openSettings
                    else -> R.string.location_enable
                },
            ),
            loading = requesting,
        ) {
            when {
                showSettingsStep -> {
                    openAppSettings(context)
                    onClose()
                }

                // Already have foreground and only the background grant is
                // missing — skip a dialog that would do nothing and go straight
                // to where the setting actually lives.
                mode == LocationMode.ARRIVAL &&
                    LocationReader.hasForegroundPermission(context) -> showSettingsStep = true

                else -> {
                    requesting = true
                    foregroundLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        ),
                    )
                }
            }
        }

        Text(
            stringResource(R.string.location_notNow),
            fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 2.dp)
                .clickableUnlessBusy(onClick = onClose),
        )
    }
}

@Composable
private fun StepRow(marker: @Composable () -> Unit, text: AnnotatedString) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        marker()
        Text(
            text,
            fontFamily = Geist, fontSize = 14.sp, lineHeight = 20.sp, color = Theme.ink,
            modifier = Modifier.weight(1f).padding(top = 4.dp),
        )
    }
}

@Composable
private fun NumberMarker(number: Int) {
    Box(
        Modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(Theme.wine.copy(alpha = 0.1f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            number.toString(),
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 15.sp, color = Theme.wine,
        )
    }
}

@Composable
private fun TipIcon() {
    Box(
        Modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(Theme.wine.copy(alpha = 0.1f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.TouchApp,
            contentDescription = null,
            tint = Theme.wine,
            modifier = Modifier.size(14.dp),
        )
    }
}

/**
 * `**bold**` → wine, matching the markdown the shared catalog copy uses. A tiny
 * parser rather than a library: the strings only ever use this one marker, and
 * the emphasis is the whole point — it names the exact button to tap.
 */
@Composable
private fun emphasised(raw: String): AnnotatedString {
    val accent = Theme.wine
    return buildAnnotatedString {
        raw.split("**").forEachIndexed { index, part ->
            if (index % 2 == 1) {
                withStyle(SpanStyle(color = accent, fontWeight = FontWeight.SemiBold)) {
                    append(part)
                }
            } else {
                append(part)
            }
        }
    }
}

/**
 * From API 30 the background grant cannot be given in an in-app dialog at all —
 * it is a Settings-only choice, and the system prompt exists just to point
 * there. Below that it can still be requested inline.
 */
private fun needsSettingsForBackground(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

private fun openAppSettings(context: Context) {
    val intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.fromParts("package", context.packageName, null),
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

/**
 * Whether the nearby pre-prompt has been shown yet.
 *
 * Once per install, and never when the grant already exists — a pre-prompt for
 * a permission you have is just a screen in the way.
 */
object LocationPrompt {

    private const val PREFS = "cf.location"
    private const val ASKED_NEARBY = "asked.nearby"

    fun shouldAskNearby(context: Context): Boolean {
        if (LocationReader.hasForegroundPermission(context)) return false
        return !context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(ASKED_NEARBY, false)
    }

    fun markNearbyAsked(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(ASKED_NEARBY, true)
            .apply()
    }
}
