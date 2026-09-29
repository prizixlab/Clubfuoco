package com.clubfuoco.app.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import java.net.URI

/**
 * One thumbnail width for every non-hero feed card, so a venue's cover photo
 * resolves to a SINGLE cache entry no matter which card type shows it — that
 * makes prefetching effective and roughly halves the bytes vs the stored 800px.
 */
object FeedImage {
    val thumbWidthDp: Dp = Dp(220f)
}

/**
 * The app's image view. Coil already does the memory + disk caching that iOS
 * had to hand-roll in `CachedAsyncImage`, so this is a thin wrapper whose real
 * job is the URL rewrite below.
 */
@Composable
fun FuocoImage(
    url: String?,
    modifier: Modifier = Modifier,
    targetWidth: Dp? = null,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val context = LocalContext.current
    val density = LocalDensity.current

    val resolved = if (url != null && targetWidth != null) {
        val px = with(density) { targetWidth.toPx() }.toInt()
        placesPhotoSized(url, px)
    } else {
        url
    }

    Box(modifier.background(Theme.imagePlaceholder)) {
        if (resolved != null) {
            AsyncImage(
                model = ImageRequest.Builder(context).data(resolved).crossfade(true).build(),
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/**
 * Rewrite a Google Places photo URL's `maxwidth` to the pixels a slot actually
 * shows. These URLs are stored with `maxwidth=800`; a 150dp card only needs a
 * few hundred, and bytes scale with the square of the dimension — this is the
 * single biggest lever on feed load time.
 *
 * Clamped, and left untouched for any non-Places URL (Supabase storage etc.),
 * so it is always safe to call.
 */
fun placesPhotoSized(raw: String, maxWidthPx: Int): String = runCatching {
    val uri = URI(raw)
    if (uri.host?.contains("maps.googleapis.com") != true) return raw
    val query = uri.query ?: return raw
    if (!query.contains("maxwidth=")) return raw
    val clamped = maxWidthPx.coerceIn(200, 1000)
    val rewritten = query.split("&").joinToString("&") { part ->
        if (part.startsWith("maxwidth=")) "maxwidth=$clamped" else part
    }
    URI(uri.scheme, uri.authority, uri.path, rewritten, uri.fragment).toString()
}.getOrElse { raw }
