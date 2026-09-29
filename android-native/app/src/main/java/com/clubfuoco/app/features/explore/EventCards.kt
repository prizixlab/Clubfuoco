package com.clubfuoco.app.features.explore

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FeedImage
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.models.FeedEvent

/**
 * Event cards in the explore feed's "cinema" style — the same geometry, type and
 * materials as [HeroCard] and [PosterCard] next to them, so an event reads as
 * one more card in the feed rather than a transplant from another design.
 *
 * What differs is the CONTENT, not the styling. An event leads with its own name
 * and who is playing, and names the venue underneath; a venue card leads with
 * the venue.
 *
 * Port of `EventCards.swift`.
 */

/**
 * The corner marker. Only ever ONE, and the order here is the priority: tonight
 * is time-critical, a pin is our editorial choice, "ours" is provenance.
 * Stacking all three would turn the card into a badge shelf.
 *
 * The promoter's paid `featured` flag is deliberately NOT a badge — the buyer
 * gets rank in the feed, not a label telling guests they paid.
 */
@Composable
private fun EventTag(event: FeedEvent) {
    when {
        event.isTonight -> TagPill(
            stringResource(R.string.events_tonightTag).uppercase(),
            Theme.accent,
            Color.White,
        )
        // Dark ink on gold, not white: white on #C09950 is about 2:1 and
        // unreadable at this size.
        event.pinned -> TagPill(
            stringResource(R.string.events_pickTag).uppercase(),
            Theme.gold,
            Color(0xFF221E1A),
        )
        event.house -> TagPill(
            stringResource(R.string.events_oursTag).uppercase(),
            Color.Black.copy(alpha = 0.5f),
            Color.White.copy(alpha = 0.85f),
        )
    }
}

@Composable
private fun EventPhoto(url: String?, height: androidx.compose.ui.unit.Dp, targetWidth: androidx.compose.ui.unit.Dp? = null) {
    Box(
        Modifier.fillMaxWidth().height(height).background(Theme.surface),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) {
            if (targetWidth != null) {
                FuocoImage(url, Modifier.fillMaxSize(), targetWidth = targetWidth)
            } else {
                FuocoImage(url, Modifier.fillMaxSize())
            }
        } else {
            // Not the venue glyph the club cards fall back to — an event without
            // a flyer is still an event, not a room.
            Icon(
                Icons.Filled.AutoAwesome,
                contentDescription = null,
                tint = Theme.fadedSand.copy(alpha = 0.4f),
                modifier = Modifier.size(28.dp),
            )
        }
    }
}

// ── Hero (the pinned event, leading the featured box) ────────────────────────

@Composable
fun EventHeroCard(event: FeedEvent, tonight: String, tomorrow: String, onOpen: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Theme.surface)
            .clickableUnlessBusy(onClick = onOpen),
    ) {
        Box(Modifier.fillMaxWidth().height(220.dp)) {
            EventPhoto(event.image, 220.dp)
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0.0f to Color.Black.copy(alpha = 0.45f),
                        0.5f to Color.Transparent,
                        1.0f to Color.Black.copy(alpha = 0.3f),
                    ),
                ),
            )
            Box(Modifier.align(Alignment.TopStart).padding(12.dp)) { EventTag(event) }
            if (event.isFree) {
                Box(Modifier.align(Alignment.BottomEnd).padding(12.dp)) {
                    TagPill(
                        stringResource(R.string.events_free).uppercase(),
                        Color.Black.copy(alpha = 0.55f),
                        Color.White,
                    )
                }
            }
        }

        Column(
            Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                stringResource(R.string.events_kicker).uppercase(),
                fontFamily = Geist, fontSize = 9.sp, letterSpacing = 1.3.sp,
                color = Theme.fadedSand,
            )
            Text(
                event.displayTitle,
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 30.sp, color = Theme.accent,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )

            // The line-up takes the slot the venue card gives its address,
            // hairline and all. It is the billing, and people choose a night by
            // who is playing; the blurb only shows when there is nothing to bill.
            val secondary = event.lineupLine()
                ?: event.description?.trim()?.takeIf { it.isNotEmpty() }
            secondary?.let {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.width(2.dp).height(34.dp).background(Theme.hairline))
                    Text(
                        it.take(90),
                        fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                        fontSize = 13.sp, color = Theme.stone,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    event.metaLine(tonight, tomorrow),
                    fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Row(
                    Modifier
                        .clip(CircleShape)
                        .background(Theme.ink)
                        .padding(horizontal = 16.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        stringResource(R.string.explore_viewEvent),
                        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                        color = Theme.cream,
                    )
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = null,
                        tint = Theme.cream,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
    }
}

// ── Rail card ────────────────────────────────────────────────────────────────

/**
 * Deliberately the same anatomy as [PosterCard], the venue card it sits beside
 * in the featured shelf: 150dp wide, a 168dp photo, then the title on the card's
 * own surface underneath. Events and venues are answers to the same question in
 * that row, so they must not look like two different kinds of object.
 *
 * Keep the two in step — a change to one card's frame, radius or type scale
 * belongs in both.
 */
@Composable
fun EventCard(event: FeedEvent, tonight: String, tomorrow: String, onOpen: () -> Unit) {
    Column(
        Modifier
            .width(150.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Theme.surface)
            .clickableUnlessBusy(onClick = onOpen),
    ) {
        Box(Modifier.fillMaxWidth().height(168.dp)) {
            EventPhoto(event.image, 168.dp, FeedImage.thumbWidthDp)
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0.5f to Color.Transparent,
                        1.0f to Color.Black.copy(alpha = 0.55f),
                    ),
                ),
            )
            Box(Modifier.align(Alignment.TopStart).padding(6.dp)) { EventTag(event) }
        }

        Column(
            Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            // Two lines on a reserved height, exactly as the venue card does it,
            // so every card in the row is the same height whatever the title.
            Text(
                event.displayTitle,
                fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                color = Theme.ink,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.height(34.dp),
            )
            // Day and place only. The full meta line carries door times too,
            // which truncate away at this width — they are on the event page,
            // one tap down.
            Text(
                listOfNotNull(event.dayLabel(tonight, tomorrow), event.placeLine)
                    .joinToString(" · "),
                fontFamily = Geist, fontSize = 10.sp, color = Theme.fadedSand,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
