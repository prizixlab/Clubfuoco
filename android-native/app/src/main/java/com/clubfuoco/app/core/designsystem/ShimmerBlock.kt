package com.clubfuoco.app.core.designsystem

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The shared loading primitive — a warm block that pulses. Port of
 * ios-native's `ShimmerBlock`.
 *
 * It breathes opacity rather than sweeping a gradient: the feed shows a dozen
 * of these at once, and a dozen animated gradients is real work for no visual
 * gain at this size.
 */
@Composable
fun ShimmerBlock(
    modifier: Modifier = Modifier,
    corner: Dp = 8.dp,
) {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val alpha by transition.animateFloat(
        initialValue = 0.45f,
        targetValue = 0.85f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "shimmerAlpha",
    )

    Box(
        modifier
            .clip(RoundedCornerShape(corner))
            .background(Theme.imagePlaceholder.copy(alpha = alpha)),
    )
}
