package com.clubfuoco.app.features.clubdetail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy

/**
 * The gold player card on the DJ page: accent play button, track title over a
 * "Preview" overline, a waveform, and the running times.
 *
 * THE WAVEFORM IS THE SCRUBBER. In the design it is decoration; here the bars
 * carry the played fraction and take the drag, so the most characteristic
 * element does the work rather than sitting next to a duplicate slider.
 *
 * Port of `DJPlayerControl`.
 */
private val BAR_HEIGHTS = listOf(
    6, 11, 17, 9, 22, 14, 26, 10, 18, 24, 8, 15, 20, 12, 27, 9,
    16, 21, 11, 25, 13, 19, 7, 23, 17, 10, 14, 22, 9, 18, 12, 20,
)

@Composable
fun DjPlayerControl(modifier: Modifier = Modifier) {
    // Not every artist has a playable profile — roughly one handle in ten is
    // dead or carries no public track. That is a state, not a transient, and
    // the card says so rather than spinning on it.
    val dead = DjPlayer.unavailable
    val lineStrong = Theme.fadedSand.copy(alpha = 0.34f)

    /** The fraction under the finger while scrubbing, or null. */
    var scrubbing by remember { mutableStateOf<Float?>(null) }

    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Theme.surface)
            .border(1.dp, lineStrong, RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(if (dead) Theme.fadedSand.copy(alpha = 0.25f) else Theme.accent)
                    .clickableUnlessBusy(enabled = !dead) { DjPlayer.toggle() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    when {
                        dead -> Icons.Filled.Block
                        DjPlayer.isPlaying -> Icons.Filled.Pause
                        else -> Icons.Filled.PlayArrow
                    },
                    contentDescription = null,
                    tint = if (dead) Theme.fadedSand else Theme.cream,
                    modifier = Modifier.size(18.dp).alpha(if (DjPlayer.isLoading) 0.4f else 1f),
                )
            }

            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    when {
                        dead -> stringResource(R.string.dj_previewUnavailable)
                        DjPlayer.trackTitle.isEmpty() -> stringResource(R.string.dj_loadingTrack)
                        else -> DjPlayer.trackTitle
                    },
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp,
                    color = if (dead) Theme.stone else Theme.ink,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    stringResource(R.string.dj_soundcloudPreview).uppercase(),
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 0.9.sp,
                    color = Theme.fadedSand,
                )
            }
        }

        Waveform(
            fraction = scrubbing?.toDouble() ?: DjPlayer.progress,
            dead = dead,
            lineStrong = lineStrong,
            onScrub = { scrubbing = it },
            onSeek = {
                DjPlayer.seek(it.toDouble())
                scrubbing = null
            },
            modifier = Modifier.padding(top = 14.dp),
        )

        // Times belong to a track. With nothing to play, "0:00 / 0:00" reads
        // like a player that failed rather than one with nothing to show.
        if (!dead) {
            Row(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    DjPlayer.timeLabel(DjPlayer.positionMs),
                    fontFamily = GeistMono, fontSize = 8.5.sp, letterSpacing = 0.5.sp,
                    color = Theme.fadedSand,
                )
                Text(
                    DjPlayer.timeLabel(DjPlayer.durationMs),
                    fontFamily = GeistMono, fontSize = 8.5.sp, letterSpacing = 0.5.sp,
                    color = Theme.fadedSand,
                )
            }
        }
    }
}

@Composable
private fun Waveform(
    fraction: Double,
    dead: Boolean,
    lineStrong: androidx.compose.ui.graphics.Color,
    onScrub: (Float?) -> Unit,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    var width by remember { mutableStateOf(1f) }
    // The last fraction the finger was over, committed when the drag ends —
    // seeking on every move would fire a request per pixel.
    var pending by remember { mutableStateOf(0f) }
    val played = if (dead) 0 else (BAR_HEIGHTS.size * fraction).toInt()

    Row(
        modifier
            .fillMaxWidth()
            .height(28.dp)
            .alpha(if (dead) 0.45f else 1f)
            // The bars are 2dp apart, so the whole strip takes the gesture
            // rather than the glyphs — otherwise a scrub landing between two
            // bars does nothing.
            .pointerInput(dead) {
                width = size.width.toFloat()
                if (dead) return@pointerInput
                detectTapGestures { offset ->
                    onSeek((offset.x / width.coerceAtLeast(1f)).coerceIn(0f, 1f))
                }
            }
            .pointerInput(dead) {
                width = size.width.toFloat()
                if (dead) return@pointerInput
                detectDragGestures(
                    onDragEnd = { onSeek(pending) },
                    onDragCancel = { onScrub(null) },
                ) { change, _ ->
                    pending = (change.position.x / width.coerceAtLeast(1f)).coerceIn(0f, 1f)
                    onScrub(pending)
                }
            },
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        BAR_HEIGHTS.forEachIndexed { index, barHeight ->
            Box(
                Modifier
                    .weight(1f)
                    .height(barHeight.dp)
                    .clip(RoundedCornerShape(1.dp))
                    .background(if (index < played) Theme.accent else lineStrong),
            )
        }
    }
}
