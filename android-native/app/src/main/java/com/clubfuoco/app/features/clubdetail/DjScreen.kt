package com.clubfuoco.app.features.clubdetail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.models.DjGig
import com.clubfuoco.app.models.FeaturedDJ
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * A DJ's page — who they are, and every dated appearance we know about.
 *
 * The schedule is OURS: appearances are scraped per artist into
 * `dj_appearances`, so there is no round-trip to the upstream listing and no
 * link out. Rows in cities we have not launched still appear — a DJ touring is
 * signal, not a gap — and the row simply isn't tappable.
 */
@Composable
fun DjScreen(
    dj: FeaturedDJ,
    queries: Queries,
    onBack: () -> Unit,
) {
    var gigs by remember(dj.raArtistId) { mutableStateOf<List<DjGig>>(emptyList()) }
    var loaded by remember(dj.raArtistId) { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current

    LaunchedEffect(dj.raArtistId) {
        // A guest has no catalogue entry, so there is nothing to look up.
        if (!dj.isGuest) gigs = queries.djSchedule(dj.raArtistId)
        loaded = true
    }

    // Point the warm widget at this artist. Never autoplays: audio that starts
    // on its own in a nightlife app is the fastest way to get uninstalled.
    // Leaving the page pauses but keeps the web view, so the next DJ is a
    // profile swap rather than a cold boot.
    DisposableEffect(dj.raArtistId) {
        DjPlayer.open(
            context = context,
            raArtistId = dj.raArtistId,
            soundcloud = dj.soundcloud,
            autoplay = false,
        )
        onDispose { DjPlayer.suspend() }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(FuocoFixed.night)
            .verticalScroll(rememberScrollState()),
    ) {
        Box(Modifier.fillMaxWidth().height(300.dp)) {
            FuocoImage(dj.coverImageUrl ?: dj.imageUrl, Modifier.fillMaxSize())
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0.0f to Color.Black.copy(alpha = 0.4f),
                        0.5f to Color.Transparent,
                        1.0f to FuocoFixed.night,
                    ),
                ),
            )
            BackChevronButton(
                Modifier.statusBarsPadding().padding(start = 16.dp, top = 8.dp),
                onClick = onBack,
            )
            Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
                Text(
                    stringResource(
                        if (dj.isGuest) R.string.dj_specialGuest else R.string.dj_featured,
                    ).uppercase(),
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.8.sp,
                    color = Theme.gold,
                )
                Text(
                    dj.name,
                    fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                    fontSize = 40.sp, color = FuocoFixed.parchment,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                dj.origin?.let {
                    Text(
                        it,
                        fontFamily = Geist, fontSize = 12.sp,
                        color = FuocoFixed.parchment.copy(alpha = 0.6f),
                    )
                }
            }
        }

        Column(
            Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            if (dj.genres.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    dj.genres.forEach { genre ->
                        Text(
                            genre.replace("_", " "),
                            fontFamily = Geist, fontSize = 11.sp,
                            color = Theme.gold,
                            modifier = Modifier
                                .clip(CircleShape)
                                .border(1.dp, Theme.gold.copy(alpha = 0.35f), CircleShape)
                                .padding(horizontal = 12.dp, vertical = 4.dp),
                        )
                    }
                }
            }

            dj.residencyLine?.let { line ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        stringResource(R.string.dj_residencyHere).uppercase(),
                        fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
                        color = FuocoFixed.parchment.copy(alpha = 0.5f),
                    )
                    Text(
                        line,
                        fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                        color = FuocoFixed.parchment,
                    )
                }
            }

            dj.bio?.takeIf { it.isNotEmpty() }?.let { bio ->
                Text(
                    bio,
                    fontFamily = Geist, fontSize = 13.sp, lineHeight = 20.sp,
                    color = FuocoFixed.parchment.copy(alpha = 0.75f),
                )
            }

            // The preview player, when the handle resolves to a real profile. A
            // dead or malformed one is filtered out here rather than rendering
            // a card that can never load.
            if (DjPlayer.canonicalSoundCloud(dj.soundcloud) != null) {
                DjPlayerControl()
            }

            // Socials. SoundCloud is deliberately NOT in this row — it is the
            // player above, and a second link to the same place would only send
            // people out of the app.
            val links = listOfNotNull(
                dj.instagram?.takeIf { it.isNotEmpty() }
                    ?.let { "Instagram" to "https://instagram.com/${it.removePrefix("@")}" },
                dj.website?.takeIf { it.isNotEmpty() }?.let { "Website" to it },
            )
            if (links.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    links.forEach { (label, url) ->
                        Text(
                            label,
                            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 12.sp,
                            color = FuocoFixed.parchment,
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(Color.White.copy(alpha = 0.08f))
                                .clickableUnlessBusy { uriHandler.openUri(url) }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    stringResource(R.string.dj_upcoming).uppercase(),
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
                    color = FuocoFixed.parchment.copy(alpha = 0.5f),
                )
                if (loaded && gigs.isEmpty()) {
                    Text(
                        stringResource(R.string.dj_noDates),
                        fontFamily = Geist, fontSize = 13.sp,
                        color = FuocoFixed.parchment.copy(alpha = 0.5f),
                    )
                }
                gigs.forEach { gig -> GigRow(gig) }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun GigRow(gig: DjGig) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.05f))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(Modifier.width(46.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val day = runCatching { LocalDate.parse(gig.date) }.getOrNull()
            Text(
                day?.format(DateTimeFormatter.ofPattern("EEE", Locale.getDefault()))
                    ?.uppercase().orEmpty(),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.2.sp,
                color = Theme.gold,
            )
            Text(
                day?.dayOfMonth?.toString().orEmpty(),
                fontFamily = Geist, fontWeight = FontWeight.Bold, fontSize = 20.sp,
                color = FuocoFixed.parchment,
            )
        }
        Column(Modifier.weight(1f)) {
            Text(
                gig.venueName ?: gig.title.orEmpty(),
                fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                color = FuocoFixed.parchment,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOfNotNull(gig.city, gig.country).joinToString(", "),
                fontFamily = Geist, fontSize = 11.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.5f),
            )
        }
        // A city we have not launched: say so rather than offering a dead link.
        if (gig.clubId == null) {
            Text(
                stringResource(R.string.dj_comingSoonShort),
                fontFamily = Geist, fontSize = 10.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.4f),
            )
        }
    }
}
