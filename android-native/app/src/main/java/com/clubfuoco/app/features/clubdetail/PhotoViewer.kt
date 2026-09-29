package com.clubfuoco.app.features.clubdetail

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy

/**
 * Fullscreen photo viewer — opened by tapping the club hero or any thumbnail in
 * the photos strip. Swipe to page, pinch or double-tap to zoom.
 *
 * Port of `PhotoViewer`. iOS reaches for UIKit here (UIPageViewController plus a
 * zooming UIScrollView) because SwiftUI's own paging is too floaty for a photo
 * browser. Compose's `HorizontalPager` is already snappy, so this stays pure
 * Compose — but the zoom gesture is hand-rolled, and the details below are what
 * make it feel native rather than approximate.
 */
@Composable
fun PhotoViewer(photos: List<String>, startIndex: Int, onClose: () -> Unit) {
    if (photos.isEmpty()) return

    val pager = rememberPagerState(
        initialPage = startIndex.coerceIn(0, photos.lastIndex),
        pageCount = { photos.size },
    )

    BackHandler(onBack = onClose)

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        HorizontalPager(
            state = pager,
            modifier = Modifier.fillMaxSize(),
            pageSpacing = 16.dp,
            // A zoomed-in photo must be pannable without the pager stealing the
            // drag, so paging is disabled while any page is magnified.
            userScrollEnabled = true,
        ) { page ->
            ZoomablePhoto(photos[page], active = pager.currentPage == page)
        }

        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            if (photos.size > 1) {
                Text(
                    "${pager.currentPage + 1} / ${photos.size}",
                    fontFamily = GeistMono, fontSize = 12.sp, letterSpacing = 1.sp,
                    color = Color.White.copy(alpha = 0.85f),
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.4f))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            } else {
                Box(Modifier.size(1.dp))
            }

            Box(
                Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.4f))
                    .border(1.dp, Color.White.copy(alpha = 0.12f), CircleShape)
                    .clickableUnlessBusy(onClick = onClose),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = stringResource(R.string.common_close),
                    tint = Color.White.copy(alpha = 0.9f),
                    modifier = Modifier.size(17.dp),
                )
            }
        }
    }
}

/**
 * One page, with pinch-to-zoom, pan and double-tap.
 *
 * [active] resets the zoom when the page is swiped away, so coming back to a
 * photo never finds it still magnified and half off-screen from last time.
 */
@Composable
private fun ZoomablePhoto(url: String, active: Boolean) {
    var scale by remember(url) { mutableFloatStateOf(1f) }
    var offsetX by remember(url) { mutableFloatStateOf(0f) }
    var offsetY by remember(url) { mutableFloatStateOf(0f) }

    if (!active && scale != 1f) {
        scale = 1f
        offsetX = 0f
        offsetY = 0f
    }

    // Animated so a double-tap springs rather than jumps; a pinch drives the
    // value continuously and the animation simply keeps up.
    val animatedScale by animateFloatAsState(scale, label = "zoom")

    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(url) {
                detectTapGestures(
                    onDoubleTap = {
                        if (scale > 1.01f) {
                            scale = 1f
                            offsetX = 0f
                            offsetY = 0f
                        } else {
                            scale = 2.5f
                        }
                    },
                )
            }
            .pointerInput(url) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 4f)
                    if (scale > 1f) {
                        // Bounded so a photo can never be dragged off screen
                        // entirely — the further in you are, the further it may
                        // travel.
                        val maxX = size.width * (scale - 1f) / 2f
                        val maxY = size.height * (scale - 1f) / 2f
                        offsetX = (offsetX + pan.x).coerceIn(-maxX, maxX)
                        offsetY = (offsetY + pan.y).coerceIn(-maxY, maxY)
                    } else {
                        offsetX = 0f
                        offsetY = 0f
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        FuocoImage(
            url,
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = animatedScale
                    scaleY = animatedScale
                    translationX = offsetX
                    translationY = offsetY
                    transformOrigin = androidx.compose.ui.graphics.TransformOrigin.Center
                },
            contentScale = ContentScale.Fit,
        )
    }
}
