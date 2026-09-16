package com.clubfuoco.app.features.clubdetail

import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
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
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
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
import java.util.Locale

/**
 * Everything we hold about one event, opened by tapping its card on a club page.
 *
 * Drawn from measured coverage of the real data, which means it has to survive
 * four states rather than one happy path:
 *
 *   1. rich       — flyer, copy, several linked DJs, age, capacity
 *   2. no lineup  — 29% of events bill no artists at all
 *   3. floor      — no flyer AND no copy: title, time, venue, promoter only
 *   4. unlinked   — credits that are real names but not DJs we hold
 *
 * NOTHING HERE IS FAKED WHEN ABSENT. A missing flyer removes the image, a
 * missing lineup says so, and the two fields that lie — `cost` and
 * `venue_capacity` — are gated behind validators on [ClubEvent] rather than
 * shown raw.
 *
 * Port of `EventDetailSheet`.
 */
@Composable
fun EventDetailSheet(
    event: ClubEvent,
    djFor: (LineupCredit) -> FeaturedDJ?,
    onOpenDj: (FeaturedDJ) -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    var expanded by remember { mutableStateOf(false) }
    val lineStrong = Theme.fadedSand.copy(alpha = 0.34f)
    val (weekday, day, month) = event.dateParts
    val dayLabel = "$day ${month.lowercase().replaceFirstChar { it.uppercase() }}"

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.event_label).uppercase(),
                fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.9.sp,
                color = Theme.fadedSand,
                modifier = Modifier.weight(1f),
            )
            RoundChip(Icons.Filled.Share) {
                shareEvent(context, event, dayLabel)
            }
            Spacer(Modifier.size(8.dp))
            RoundChip(Icons.Filled.Close, onClose)
        }

        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            event.image?.let { flyer ->
                FuocoImage(
                    flyer,
                    Modifier
                        .padding(horizontal = 18.dp)
                        .padding(top = 6.dp)
                        .fillMaxWidth()
                        .height(200.dp)
                        .clip(RoundedCornerShape(16.dp)),
                    targetWidth = 800.dp,
                )
            }

            // ── Head ─────────────────────────────────────────────────────────
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp)
                    .padding(top = if (event.image == null) 20.dp else 16.dp),
            ) {
                Text(
                    listOf(weekday, event.venueName.orEmpty())
                        .filter { it.isNotEmpty() }
                        .joinToString(" · ")
                        .uppercase(),
                    fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.5.sp,
                    color = Theme.accent,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                Text(
                    event.title,
                    fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                    fontSize = 27.sp, lineHeight = 31.sp, color = Theme.ink,
                )

                // Meta row — day, hours, age, interest — each part dropped when
                // absent so it never renders a stray separator.
                FlowRow(
                    Modifier.padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Meta(dayLabel)
                    event.timeRange?.let { (label, crosses) ->
                        Dot()
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Meta(label)
                            // The end time usually belongs to the next day; say
                            // so rather than letting "23:00 – 06:00" read as one
                            // morning.
                            if (crosses) {
                                Text(
                                    "+1",
                                    fontFamily = GeistMono, fontSize = 10.5.sp,
                                    letterSpacing = 0.8.sp, color = Theme.fadedSand,
                                )
                            }
                        }
                    }
                    event.minimumAge?.let { age ->
                        Dot()
                        Text(
                            "$age+",
                            fontFamily = GeistMono, fontSize = 10.5.sp, letterSpacing = 0.8.sp,
                            color = Theme.stone,
                            modifier = Modifier
                                .clip(CircleShape)
                                .border(1.dp, lineStrong, CircleShape)
                                .padding(horizontal = 8.dp, vertical = 2.dp),
                        )
                    }
                    event.interested?.takeIf { it > 0 }?.let { n ->
                        Dot()
                        Meta(stringResource(R.string.event_interestedCount, compact(n)))
                    }
                }

                event.promoters?.takeIf { it.isNotEmpty() }?.let { promoters ->
                    Text(
                        stringResource(R.string.detail_presentedBy, promoters.joinToString(", ")),
                        fontFamily = Geist, fontSize = 12.5.sp, color = Theme.fadedSand,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }

                // Only rendered when the source actually gave a usable value.
                if (event.entryLabel != null || event.capacityLabel != null) {
                    FlowRow(
                        Modifier.padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        event.entryLabel?.let {
                            FactChip(stringResource(R.string.event_entry), it, lineStrong)
                        }
                        event.capacityLabel?.let {
                            FactChip(stringResource(R.string.event_capacity), it, lineStrong)
                        }
                    }
                }
            }

            // ── Description ──────────────────────────────────────────────────
            // Only when there is enough of it to be worth a section: a handful
            // of rows carry a few characters of nothing.
            event.description?.trim()?.takeIf { it.length >= 40 }?.let { copy ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp)
                        .padding(top = 18.dp)
                        .animateContentSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        copy,
                        fontFamily = Geist, fontSize = 13.5.sp, lineHeight = 19.sp,
                        color = Theme.stone,
                        maxLines = if (expanded) Int.MAX_VALUE else 5,
                        overflow = TextOverflow.Ellipsis,
                    )
                    // Median copy is ~640 characters of marketing prose, so it
                    // is clamped rather than allowed to push the lineup off the
                    // screen entirely.
                    if (copy.length > 260) {
                        Text(
                            stringResource(
                                if (expanded) R.string.event_less else R.string.event_more,
                            ).uppercase(),
                            fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.sp,
                            color = Theme.accent,
                            modifier = Modifier.clickableUnlessBusy { expanded = !expanded },
                        )
                    }
                }
            }

            // ── Lineup ───────────────────────────────────────────────────────
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(top = 20.dp),
            ) {
                Text(
                    stringResource(R.string.event_lineup).uppercase(),
                    fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 1.9.sp,
                    color = Theme.accent,
                    modifier = Modifier.padding(bottom = 12.dp),
                )

                if (event.credits.isEmpty()) {
                    // 29% of events bill nobody. Say that plainly instead of
                    // rendering an empty section.
                    Text(
                        stringResource(R.string.event_noLineup),
                        fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                    )
                } else {
                    event.credits.forEachIndexed { index, credit ->
                        if (index > 0) {
                            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
                        }
                        LineupRow(
                            credit = credit,
                            dj = djFor(credit),
                            isHeadliner = index == 0 && event.credits.size > 1,
                            onOpen = onOpenDj,
                        )
                    }
                }
            }

            // ── Venue ────────────────────────────────────────────────────────
            event.venueName?.takeIf { it.isNotEmpty() }?.let { venue ->
                Column(
                    Modifier
                        .padding(horizontal = 18.dp)
                        .padding(top = 16.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Theme.surface)
                        .border(1.dp, lineStrong, RoundedCornerShape(16.dp))
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        stringResource(R.string.event_venue).uppercase(),
                        fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
                        color = Theme.fadedSand,
                    )
                    Text(
                        venue,
                        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.5.sp,
                        color = Theme.ink,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun LineupRow(
    credit: LineupCredit,
    dj: FeaturedDJ?,
    isHeadliner: Boolean,
    onOpen: (FeaturedDJ) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            // One target for the whole row. Without this the gap between the
            // name and the chevron hit-tests to nothing, leaving two live
            // islands with a dead strip between them — and that strip is the
            // widest part of the row.
            .then(
                if (dj != null) Modifier.clickableUnlessBusy { onOpen(dj) } else Modifier,
            )
            // A name we hold no page for is real and stays listed — it just
            // cannot be opened, and is dimmed so the affordance is honest.
            .alpha(if (dj == null) 0.55f else 1f)
            .padding(vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(Theme.surface),
            contentAlignment = Alignment.Center,
        ) {
            if (dj?.imageUrl != null) {
                FuocoImage(dj.imageUrl, Modifier.fillMaxSize(), targetWidth = 40.dp)
            } else {
                Text(
                    credit.name.take(1).uppercase(),
                    fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                    fontSize = 16.sp, color = Theme.fadedSand,
                )
            }
        }

        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                credit.name,
                fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp,
                color = if (dj == null) Theme.stone else Theme.ink,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            // The source bills in order, so the first name is the headliner.
            if (isHeadliner) {
                Text(
                    stringResource(R.string.event_headliner).uppercase(),
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.sp,
                    color = Theme.fadedSand,
                )
            }
        }

        if (dj != null) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = Theme.accent,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

@Composable
private fun Meta(text: String) {
    Text(
        text,
        fontFamily = GeistMono, fontSize = 10.5.sp, letterSpacing = 0.8.sp,
        color = Theme.stone,
    )
}

@Composable
private fun Dot() {
    Box(Modifier.size(3.dp).clip(CircleShape).background(Theme.fadedSand))
}

@Composable
private fun FactChip(label: String, value: String, line: androidx.compose.ui.graphics.Color) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(Theme.surface)
            .border(1.dp, line, CircleShape)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            label.uppercase(),
            fontFamily = GeistMono, fontSize = 9.5.sp, letterSpacing = 0.8.sp,
            color = Theme.stone,
        )
        Text(
            value,
            fontFamily = GeistMono, fontWeight = FontWeight.SemiBold, fontSize = 9.5.sp,
            letterSpacing = 0.8.sp, color = Theme.ink,
        )
    }
}

@Composable
private fun RoundChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(Theme.surface)
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Theme.stone, modifier = Modifier.size(14.dp))
    }
}

/** 1042 → "1.0k". The counts run from single digits to four figures. */
private fun compact(n: Int): String =
    if (n >= 1000) String.format(Locale.getDefault(), "%.1fk", n / 1000.0) else n.toString()

private fun shareEvent(context: Context, event: ClubEvent, dayLabel: String) {
    val text = listOf(event.title, dayLabel, event.venueName.orEmpty())
        .filter { it.isNotEmpty() }
        .joinToString(" · ")
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, event.title))
}
