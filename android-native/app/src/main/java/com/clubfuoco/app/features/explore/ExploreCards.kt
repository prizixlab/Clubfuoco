package com.clubfuoco.app.features.explore

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Star
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
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.FuocoRadius
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.features.rumbalist.FuocoScore
import com.clubfuoco.app.models.FeedEvent
import com.clubfuoco.app.models.Place

/**
 * The explore "cinema" cards — hero, landscape and poster — and the shelf row.
 * Port of `ExploreCards.swift`.
 */

/** Save toggle on card photos. 44dp hit target with the glyph centred in it. */
@Composable
private fun SaveBookmark(isSaved: Boolean, size: Int, onSave: () -> Unit) {
    Box(
        Modifier.size(44.dp).clickableUnlessBusy(onClick = onSave),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(size.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.45f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (isSaved) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size((size * 0.5).dp),
            )
        }
    }
}

@Composable
internal fun TagPill(
    text: String,
    background: Color = Color.Black.copy(alpha = 0.5f),
    color: Color = Color.White.copy(alpha = 0.85f),
) {
    Text(
        text.uppercase(),
        fontFamily = Geist,
        fontWeight = FontWeight.Medium,
        fontSize = 9.sp,
        letterSpacing = 1.sp,
        color = color,
        maxLines = 1,
        modifier = Modifier
            .clip(CircleShape)
            .background(background)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

private val bottomScrim = Brush.verticalGradient(
    0f to Color.Transparent,
    0.55f to Color.Transparent,
    1f to Color.Black.copy(alpha = 0.7f),
)

// ── Hero (featured shelf lead) ───────────────────────────────────────────────

@Composable
fun HeroCard(
    place: Place,
    isSaved: Boolean,
    nightPhrase: String,
    onSave: () -> Unit,
    onOpen: () -> Unit,
) {
    Box {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Theme.surface)
                .clickableUnlessBusy(onClick = onOpen),
        ) {
            Box(Modifier.fillMaxWidth().height(220.dp)) {
                FuocoImage(place.coverPhoto, Modifier.fillMaxSize())
                Box(
                    Modifier.fillMaxSize().background(
                        Brush.verticalGradient(
                            0f to Color.Black.copy(alpha = 0.45f),
                            0.5f to Color.Transparent,
                            1f to Color.Black.copy(alpha = 0.3f),
                        ),
                    ),
                )
                Box(Modifier.align(Alignment.TopStart).padding(12.dp)) {
                    TagPill(
                        (place.musicGenres.firstOrNull() ?: "Featured").replace("_", " "),
                    )
                }
                val rating = FuocoScore.score(place.placeId, place.rating).value
                if (rating != null) {
                    Row(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .padding(12.dp)
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        Icon(
                            Icons.Filled.Star,
                            contentDescription = null,
                            tint = FuocoFixed.starGold,
                            modifier = Modifier.size(10.dp),
                        )
                        Text(
                            String.format("%.1f", rating),
                            fontFamily = Geist,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                            color = Color.White,
                        )
                    }
                }
            }

            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 18.dp)) {
                Text(
                    "${stringResource(R.string.explore_featured)} $nightPhrase".uppercase(),
                    fontFamily = Geist,
                    fontSize = 9.sp,
                    letterSpacing = 1.3.sp,
                    color = Theme.fadedSand,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
                Text(
                    place.name,
                    fontFamily = InstrumentSerif,
                    fontStyle = FontStyle.Italic,
                    fontSize = 30.sp,
                    color = Theme.accent,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (place.address.isNotEmpty()) {
                    Text(
                        place.address.take(90),
                        fontFamily = InstrumentSerif,
                        fontStyle = FontStyle.Italic,
                        fontSize = 13.sp,
                        color = Theme.stone,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        listOfNotNull(
                            place.neighborhood,
                            place.priceLevel?.let { Place.priceLabels.getOrNull(it) },
                        ).joinToString(" · "),
                        fontFamily = Geist,
                        fontSize = 11.sp,
                        color = Theme.fadedSand,
                    )
                    Spacer(Modifier.weight(1f))
                    Row(
                        Modifier
                            .clip(CircleShape)
                            .background(Theme.ink)
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            stringResource(R.string.explore_viewClub),
                            fontFamily = Geist,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
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
        Box(Modifier.align(Alignment.TopEnd).padding(6.dp)) {
            SaveBookmark(isSaved, 32, onSave)
        }
    }
}

// ── Landscape card ───────────────────────────────────────────────────────────

@Composable
fun LandCard(place: Place, isSaved: Boolean, onSave: () -> Unit, onOpen: () -> Unit) {
    Box(Modifier.width(220.dp).height(130.dp)) {
        Box(
            Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(12.dp))
                .clickableUnlessBusy(onClick = onOpen),
        ) {
            FuocoImage(place.coverPhoto, Modifier.fillMaxSize(), targetWidth = FeedImage.thumbWidthDp)
            Box(Modifier.fillMaxSize().background(bottomScrim))

            place.musicGenres.firstOrNull()?.let {
                Box(Modifier.align(Alignment.TopStart).padding(7.dp)) {
                    TagPill(it.replace("_", " "), Color.Black.copy(alpha = 0.45f))
                }
            }

            Column(
                Modifier
                    .align(Alignment.BottomStart)
                    .padding(horizontal = 10.dp)
                    .padding(bottom = 8.dp),
            ) {
                Text(
                    place.name,
                    fontFamily = Geist,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOfNotNull(
                        place.neighborhood,
                        place.priceLevel?.let { Place.priceLabels.getOrNull(it) },
                    ).joinToString(" · "),
                    fontFamily = Geist,
                    fontSize = 10.sp,
                    color = Color.White.copy(alpha = 0.6f),
                    maxLines = 1,
                )
            }
        }
        Box(Modifier.align(Alignment.TopEnd).padding(2.dp)) {
            SaveBookmark(isSaved, 28, onSave)
        }
    }
}

// ── Poster card ──────────────────────────────────────────────────────────────

@Composable
fun PosterCard(place: Place, isSaved: Boolean, onSave: () -> Unit, onOpen: () -> Unit) {
    Box(Modifier.width(150.dp)) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Theme.surface)
                .clickableUnlessBusy(onClick = onOpen),
        ) {
            Box(Modifier.fillMaxWidth().height(168.dp)) {
                FuocoImage(place.coverPhoto, Modifier.fillMaxSize(), targetWidth = FeedImage.thumbWidthDp)
                Box(
                    Modifier.fillMaxSize().background(
                        Brush.verticalGradient(
                            0.5f to Color.Transparent,
                            1f to Color.Black.copy(alpha = 0.55f),
                        ),
                    ),
                )
                Box(Modifier.align(Alignment.TopStart).padding(6.dp)) {
                    if (place.isOpen == true) {
                        TagPill(stringResource(R.string.explore_open), Theme.success, Color.White)
                    } else {
                        place.distance?.let {
                            TagPill(
                                ExploreViewModel.formatDistance(it),
                                Color.Black.copy(alpha = 0.4f),
                                Color.White.copy(alpha = 0.75f),
                            )
                        }
                    }
                }
            }
            Column(Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 10.dp)) {
                // Reserved height keeps every card in the row the same height.
                Text(
                    place.name,
                    fontFamily = Geist,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = Theme.ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.height(34.dp),
                )
                Text(
                    place.neighborhood ?: place.address,
                    fontFamily = Geist,
                    fontSize = 10.sp,
                    color = Theme.fadedSand,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box(Modifier.align(Alignment.TopEnd).padding(3.dp)) {
            SaveBookmark(isSaved, 26, onSave)
        }
    }
}

// ── Shelf row ────────────────────────────────────────────────────────────────

@Composable
fun ShelfRow(
    shelf: Shelf,
    index: Int,
    saved: Set<String>,
    nightPhrase: String,
    onSave: (Place) -> Unit,
    onOpen: (Place) -> Unit,
    onOpenShelf: (Shelf) -> Unit,
    /** Our own nights. Only the featured shelf carries them. */
    leadEvent: FeedEvent? = null,
    mixedEvents: List<FeedEvent> = emptyList(),
    onOpenEvent: (FeedEvent) -> Unit = {},
) {
    val tonight = stringResource(R.string.plan_tonight)
    val tomorrow = stringResource(R.string.plan_tomorrow)
    // The featured deal shelf is grouped inside a soft gold-framed box so it
    // reads as one distinct section; everything else flows edge-to-edge.
    val isHero = shelf.id == "hero"
    val hPad = if (isHero) 16.dp else 20.dp

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = if (isHero) 12.dp else 0.dp)
            .padding(bottom = if (isHero) 40.dp else 32.dp)
            .then(
                if (isHero) {
                    Modifier
                        .clip(RoundedCornerShape(22.dp))
                        .background(Theme.gold.copy(alpha = 0.06f))
                        .border(1.dp, Theme.gold.copy(alpha = 0.35f), RoundedCornerShape(22.dp))
                        .padding(top = 20.dp, bottom = 44.dp)
                } else {
                    Modifier
                },
            ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.padding(horizontal = hPad), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                shelf.subtitle.uppercase(),
                fontFamily = Geist,
                fontSize = 9.sp,
                letterSpacing = 1.3.sp,
                color = Theme.fadedSand,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    // The featured header tracks the When planner date.
                    if (isHero) nightPhrase else shelf.title,
                    fontFamily = Geist,
                    fontWeight = FontWeight.Medium,
                    fontSize = if (shelf.featured) 18.sp else 16.sp,
                    color = Theme.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                Text(
                    stringResource(R.string.explore_venuesArrow, shelf.places.size),
                    fontFamily = Geist,
                    fontSize = 12.sp,
                    color = Theme.accent,
                    maxLines = 1,
                    modifier = Modifier
                        .clickableUnlessBusy { onOpenShelf(shelf) }
                        .padding(vertical = 8.dp, horizontal = 4.dp),
                )
            }
        }

        val lead = shelf.places.firstOrNull()
        if (shelf.featured) {
            // A PINNED night takes the big card; otherwise the venue hero keeps
            // it, exactly as it did before there were events.
            Box(Modifier.padding(horizontal = hPad)) {
                if (leadEvent != null) {
                    EventHeroCard(leadEvent, tonight, tomorrow) { onOpenEvent(leadEvent) }
                } else if (lead != null) {
                    HeroCard(
                        place = lead,
                        isSaved = lead.placeId in saved,
                        nightPhrase = nightPhrase,
                        onSave = { onSave(lead) },
                        onOpen = { onOpen(lead) },
                    )
                }
            }
            // The rail under the hero mixes our nights in with the venues.
            // Events first: a dated night the app can put someone on the door
            // list for outranks a room that is merely open.
            val rail = if (leadEvent != null) shelf.places else shelf.places.drop(1)
            if (mixedEvents.isNotEmpty() || rail.isNotEmpty()) {
                MixedScroller(
                    events = mixedEvents,
                    places = rail,
                    saved = saved,
                    hPad = hPad,
                    tonight = tonight,
                    tomorrow = tomorrow,
                    onSave = onSave,
                    onOpen = onOpen,
                    onOpenEvent = onOpenEvent,
                )
            }
        } else {
            CardScroller(shelf.places, saved, index % 2 != 0, hPad, onSave, onOpen)
        }
    }
}

@Composable
private fun MixedScroller(
    events: List<FeedEvent>,
    places: List<Place>,
    saved: Set<String>,
    hPad: androidx.compose.ui.unit.Dp,
    tonight: String,
    tomorrow: String,
    onSave: (Place) -> Unit,
    onOpen: (Place) -> Unit,
    onOpenEvent: (FeedEvent) -> Unit,
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = hPad),
    ) {
        items(events, key = { "e-${it.id}" }) { event ->
            EventCard(event, tonight, tomorrow) { onOpenEvent(event) }
        }
        items(places, key = { "p-${it.placeId}" }) { place ->
            PosterCard(place, place.placeId in saved, { onSave(place) }, { onOpen(place) })
        }
    }
}

@Composable
private fun CardScroller(
    places: List<Place>,
    saved: Set<String>,
    landscape: Boolean,
    hPad: androidx.compose.ui.unit.Dp,
    onSave: (Place) -> Unit,
    onOpen: (Place) -> Unit,
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = hPad),
    ) {
        items(places, key = { it.placeId }) { place ->
            if (landscape) {
                LandCard(place, place.placeId in saved, { onSave(place) }, { onOpen(place) })
            } else {
                PosterCard(place, place.placeId in saved, { onSave(place) }, { onOpen(place) })
            }
        }
    }
}
