package com.clubfuoco.app.core.designsystem

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R

/**
 * Shared building blocks for the auth surfaces — port of `Components.swift`,
 * itself the native counterpart of AuthField / PrimaryBtn / ProgressBar in the
 * web (auth) pages.
 */

/** Small uppercase monospaced overline used across the brand. */
@Composable
fun Kicker(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Theme.wine,
    size: TextUnit = 9.5.sp,
) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        fontFamily = GeistMono,
        fontSize = size,
        letterSpacing = 2.0.sp,
        color = color,
    )
}

/** Labelled rounded field container with a mono uppercase label above. */
@Composable
fun AuthField(
    label: String,
    modifier: Modifier = Modifier,
    error: Boolean = false,
    content: @Composable () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Kicker(label, color = Theme.fadedSand, size = 9.sp)
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 50.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (error) Theme.wine.copy(alpha = 0.04f) else Theme.surface)
                .border(
                    BorderStroke(1.dp, if (error) Theme.wine else Theme.ink.copy(alpha = 0.08f)),
                    RoundedCornerShape(12.dp),
                )
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            content()
        }
    }
}

/** Wine-red primary CTA with trailing arrow; "Please wait…" while loading. */
@Composable
fun PrimaryButton(
    title: String,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    enabled: Boolean = true,
    background: Color = Theme.wine,
    onClick: () -> Unit,
) {
    val disabled = !enabled
    val alpha = when {
        disabled && !loading -> 0.3f
        loading -> 0.7f
        else -> 1f
    }
    Box(
        modifier
            .fillMaxWidth()
            .height(55.dp)
            .clip(RoundedCornerShape(FuocoRadius.field))
            .background(background.copy(alpha = alpha))
            .clickableUnlessBusy(enabled = enabled && !loading, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (loading) {
                Text(
                    stringResource(R.string.auth_pleaseWait),
                    fontFamily = Geist,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = Theme.cream,
                )
            } else {
                Text(
                    title,
                    fontFamily = Geist,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = Theme.cream,
                )
                Icon(
                    Icons.AutoMirrored.Filled.ArrowForward,
                    contentDescription = null,
                    tint = Theme.cream,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

/** Thin segmented progress bar for the signup wizard. */
@Composable
fun SegmentedProgress(step: Int, total: Int, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(total) { index ->
            Box(
                Modifier
                    .weight(1f)
                    .height(2.dp)
                    .clip(CircleShape)
                    .background(if (index < step) Theme.wine else Theme.ink.copy(alpha = 0.16f)),
            )
        }
    }
}

/** Mono uppercase "← BACK" header button. */
@Composable
fun BackChevronButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier.clickableUnlessBusy(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            contentDescription = null,
            tint = Theme.stone,
            modifier = Modifier.size(16.dp),
        )
        Text(
            stringResource(R.string.auth_back).uppercase(),
            fontFamily = GeistMono,
            fontSize = 10.sp,
            letterSpacing = 1.8.sp,
            color = Theme.stone,
        )
    }
}

/** Inline error message in brand red. */
@Composable
fun FormError(message: String, modifier: Modifier = Modifier) {
    Text(
        message,
        modifier = modifier.fillMaxWidth(),
        fontFamily = Geist,
        fontSize = 12.sp,
        color = Theme.wine,
    )
}
