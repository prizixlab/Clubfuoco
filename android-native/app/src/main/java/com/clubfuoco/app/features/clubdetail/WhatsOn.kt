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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.models.ClubEvent
import com.clubfuoco.app.models.FeaturedDJ
import com.clubfuoco.app.models.LineupCredit

/**
 * "What's on" — Featured DJ boxes first (the highlight), then dated event
 * cards. Busy venues can have a dozen of each, so the list collapses to a few
 * behind a "see all" toggle to keep the page scannable.
 *
 * We do NOT sell these events: the upstream listing has no purchase API, and
 * the source is deliberately never named to the customer.
 */
private const val COLLAPSED = 4

@Composable
fun WhatsOnSection(
    events: List<ClubEvent>,
    featuredDjs: List<FeaturedDJ>,
    djFor: (LineupCredit) -> FeaturedDJ?,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    onOpenDj: (FeaturedDJ) -> Unit,
    modifier: Modifier = Modifier,
) {
    val total = featuredDjs.size + events.size
    val limit = if (expanded) total else COLLAPSED
    val djShown = minOf(featuredDjs.size, limit)
    val eventsShown = (limit - djShown).coerceAtLeast(0)

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                stringResource(R.string.detail_upcomingEvents).uppercase(),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.8.sp,
                color = Theme.fadedSand,
            )
            Text(
                stringResource(R.string.detail_whatsOn),
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 22.sp, color = Theme.ink,
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            featuredDjs.take(djShown).forEach { dj ->
                FeaturedDjBox(dj) { onOpenDj(dj) }
            }
            events.take(eventsShown).forEach { event ->
                EventBox(event, djFor, onOpenDj)
            }
        }

        if (total > COLLAPSED) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, Theme.gold.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                    .clickableUnlessBusy(onClick = onToggleExpanded)
                    .padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (expanded) stringResource(R.string.detail_showLess)
                    else stringResource(R.string.detail_seeAll, total),
                    fontFamily = GeistMono, fontWeight = FontWeight.Medium,
                    fontSize = 11.sp, letterSpacing = 0.5.sp, color = Theme.gold,
                )
                Spacer(Modifier.width(6.dp))
                Icon(
                    if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                    tint = Theme.gold,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}

@Composable
private fun FeaturedDjBox(dj: FeaturedDJ, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.cream)
            .border(1.dp, Theme.hairline, RoundedCornerShape(14.dp))
            .clickableUnlessBusy(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(56.dp).clip(CircleShape)) {
            FuocoImage(dj.imageUrl, Modifier.fillMaxSize(), targetWidth = 56.dp)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                stringResource(
                    if (dj.isGuest) R.string.dj_specialGuest else R.string.dj_featured,
                ).uppercase(),
                fontFamily = GeistMono, fontSize = 8.5.sp, letterSpacing = 1.4.sp,
                color = Theme.gold,
            )
            Text(
                dj.name,
                fontFamily = InstrumentSerif, fontSize = 20.sp, color = Theme.ink,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            dj.residencyLine?.let {
                Text(
                    it,
                    fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun EventBox(
    event: ClubEvent,
    djFor: (LineupCredit) -> FeaturedDJ?,
    onOpenDj: (FeaturedDJ) -> Unit,
) {
    val (weekday, day, month) = event.dateParts

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.cream)
            .border(1.dp, Theme.hairline, RoundedCornerShape(14.dp)),
    ) {
        event.image?.let { flyer ->
            FuocoImage(flyer, Modifier.fillMaxWidth().height(160.dp), targetWidth = 700.dp)
        }

        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            // The date block — the thing people scan for.
            Column(
                Modifier.width(46.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    weekday,
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.2.sp,
                    color = Theme.gold,
                )
                Text(
                    day,
                    fontFamily = Geist, fontWeight = FontWeight.Bold, fontSize = 22.sp,
                    color = Theme.ink,
                )
                Text(
                    month,
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.sp,
                    color = Theme.fadedSand,
                )
            }

            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    event.title,
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    color = Theme.ink,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    event.startLabel?.let {
                        Text(it, fontFamily = Geist, fontSize = 12.sp, color = Theme.fadedSand)
                    }
                    event.entryLabel?.let {
                        Text(it, fontFamily = Geist, fontSize = 12.sp, color = Theme.fadedSand)
                    }
                    event.interested?.takeIf { it > 0 }?.let {
                        Text(
                            stringResource(R.string.detail_interestedCount, it),
                            fontFamily = Geist, fontSize = 12.sp, color = Theme.fadedSand,
                        )
                    }
                }

                if (event.credits.isNotEmpty()) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        // Billing order, every DJ on the night. A name we hold
                        // in the catalogue is tappable; anything else is plain.
                        event.visibleCredits.forEach { credit ->
                            val dj = djFor(credit)
                            Text(
                                credit.name,
                                fontFamily = Geist,
                                fontWeight = if (dj != null) FontWeight.Medium else FontWeight.Normal,
                                fontSize = 12.sp,
                                color = if (dj != null) Theme.wine else Theme.stone,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .border(
                                        1.dp,
                                        if (dj != null) Theme.wine.copy(alpha = 0.35f)
                                        else Theme.fadedSand.copy(alpha = 0.3f),
                                        CircleShape,
                                    )
                                    .then(
                                        if (dj != null) {
                                            Modifier.clickableUnlessBusy { onOpenDj(dj) }
                                        } else {
                                            Modifier
                                        },
                                    )
                                    .padding(horizontal = 9.dp, vertical = 5.dp),
                            )
                        }
                        if (event.extraCredits > 0) {
                            Text(
                                "+${event.extraCredits}",
                                fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
                                modifier = Modifier.padding(vertical = 5.dp),
                            )
                        }
                    }
                }

                event.promoters?.takeIf { it.isNotEmpty() }?.let { promoters ->
                    Text(
                        stringResource(R.string.detail_presentedBy, promoters.joinToString(" · ")),
                        fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
                    )
                }

                event.description?.trim()?.takeIf { it.isNotEmpty() }?.let {
                    Text(
                        it,
                        fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                        lineHeight = 17.sp,
                        maxLines = 6, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
