package com.clubfuoco.app.features.rumbalist

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.Theme

/**
 * The offer supplier's lockup. Port of `SupplierMark`.
 *
 * Suppliers are offer providers, not the face of the app, but their contract
 * can require visible credit wherever their offer appears — so this is the one
 * place in the app that renders somebody else's brand, and it is confined to
 * the booking surfaces. App chrome stays Club Fuoco.
 *
 * Three cases, in order:
 *
 *  - Rumba gets its signature treatment: the bundled wordmark masking a gloss
 *    sweep in the supplier's own accent (accent → white → accent). That look
 *    predates the swappable-supplier refactor and was contractually kept.
 *  - Any other supplier renders its remote logo at the same height.
 *  - No logo set, or the logo hasn't loaded yet: the name in the accent.
 *
 * Nothing here is hard-coded per supplier apart from the bundled Rumba
 * wordmark — the colour and the name come from GET /api/partner, so swapping
 * the active supplier in the Partner Portal swaps the mark with no app release.
 */
@Composable
fun SupplierMark(
    brand: PartnerBrand,
    height: Dp = 18.dp,
    animated: Boolean = true,
    /**
     * Repaint the mark in this colour. Supplier logos are single-ink wordmarks
     * with the ink baked into the PNG, so a light mark is invisible on a light
     * surface. Pass the surrounding text colour on light cards; leave it null
     * on dark ones, where the supplier's own ink is what they intended.
     */
    tint: Color? = null,
    modifier: Modifier = Modifier,
) {
    val accent = remember(brand.color) { parseHex(brand.color) } ?: Theme.ember

    when {
        brand.key == "rumba" -> RumbaGloss(accent, height, animated, modifier)

        !brand.logoUrl.isNullOrBlank() -> {
            // A remote logo has no intrinsic size until it loads, so the row
            // would jump. Reserve the height and let the width settle.
            Box(modifier.height(height)) {
                AsyncImage(
                    model = brand.logoUrl,
                    contentDescription = brand.name,
                    contentScale = ContentScale.Fit,
                    // SrcIn keeps the glyph shapes and discards the baked-in
                    // ink — the Compose equivalent of template rendering.
                    colorFilter = tint?.let { ColorFilter.tint(it) },
                    modifier = Modifier.height(height).widthIn(max = height * 12),
                )
            }
        }

        else -> NameText(brand.name, height, tint ?: accent, modifier)
    }
}

/**
 * The pre-refactor Rumbalist look: a gloss sweeping through the bundled
 * wordmark in the brand's accent.
 *
 * The sweep is a gradient painted over the wordmark and clipped to its alpha,
 * which needs its own compositing layer — without [CompositingStrategy.Offscreen]
 * the blend would eat whatever is already on the screen behind the mark.
 */
@Composable
private fun RumbaGloss(
    accent: Color,
    height: Dp,
    animated: Boolean,
    modifier: Modifier,
) {
    // The bundled wordmark's aspect ratio (512 × 104, resized from the 1600 ×
    // 325 original — a 26dp mark needs 104px at the densest screen we ship to).
    val aspect = 512f / 104f

    val sweep = if (animated) {
        val transition = rememberInfiniteTransition(label = "supplierGloss")
        transition.animateFloat(
            initialValue = -1f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 3400, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
            label = "sweep",
        ).value
    } else {
        // Parked at the start, which puts the white band off the left edge and
        // leaves flat accent. Deliberate: the un-animated mark is the 11dp
        // inline one, and a white blob halfway through a wordmark that small
        // reads as a rendering fault rather than as gloss.
        -1f
    }

    Image(
        painter = painterResource(R.drawable.rumbalist_logo),
        contentDescription = "Rumba",
        contentScale = ContentScale.Fit,
        modifier = modifier
            .size(width = height * aspect, height = height)
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                drawRect(
                    brush = Brush.linearGradient(
                        0.00f to accent,
                        0.38f to accent,
                        0.50f to Color.White,
                        0.62f to accent,
                        1.00f to accent,
                        start = Offset(sweep * size.width, size.height / 2f),
                        end = Offset((sweep + 1.6f) * size.width, size.height / 2f),
                    ),
                    blendMode = BlendMode.SrcIn,
                )
            },
    )
}

/** Last resort, and the placeholder while a remote logo loads. */
@Composable
private fun NameText(name: String, height: Dp, color: Color, modifier: Modifier) {
    Text(
        name.uppercase(),
        fontFamily = Geist,
        fontWeight = FontWeight.Bold,
        // Sized off the requested mark height so the text lockup occupies the
        // same line as a logo would.
        fontSize = (height.value * 0.85f).sp,
        letterSpacing = (height.value * 0.12f).sp,
        color = color,
        maxLines = 1,
        modifier = modifier.heightIn(min = height),
    )
}
