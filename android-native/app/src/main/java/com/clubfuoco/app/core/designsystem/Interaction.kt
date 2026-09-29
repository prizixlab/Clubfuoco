package com.clubfuoco.app.core.designsystem

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.platform.LocalView

/**
 * Tap handling with the brand's haptic, and WITHOUT the Material ripple.
 *
 * The ripple is deliberately dropped: the design is a port of a SwiftUI app
 * built on `.buttonStyle(.plain)`, where a card or pill simply responds rather
 * than sprouting a circle. Keeping the ripple made every ported surface read as
 * generic Material instead of Club Fuoco.
 */
fun Modifier.clickableUnlessBusy(
    enabled: Boolean = true,
    haptic: Boolean = true,
    onClick: () -> Unit,
): Modifier = composed {
    val view = LocalView.current
    val interaction = remember { MutableInteractionSource() }
    clickable(
        interactionSource = interaction,
        indication = null,
        enabled = enabled,
    ) {
        if (haptic) view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
        onClick()
    }
}
