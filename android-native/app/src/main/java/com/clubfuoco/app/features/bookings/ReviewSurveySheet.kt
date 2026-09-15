package com.clubfuoco.app.features.bookings

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
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.DRINK_CATEGORIES
import com.clubfuoco.app.core.MUSIC_GENRES
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.Booking

/**
 * The morning-after review. Port of `ReviewSurveySheet`.
 *
 * Seven steps including the "did you actually go?" pre-gate, which is first for
 * a reason: every question after it assumes an answer that a no-show does not
 * have, and the honest "I didn't go" path has to be as easy as the yes.
 *
 * Like the invite screen, the iOS original is entirely unlocalized — every
 * string below is new, and the keys are written to be back-ported.
 */
@Composable
fun ReviewSurveySheet(
    booking: Booking,
    api: ApiClient,
    onSubmitted: (String) -> Unit,
    onClose: () -> Unit,
) {
    val model: ReviewSurveyViewModel = viewModel(key = "review:${booking.id}")
    val venue = booking.club?.name ?: stringResource(R.string.review_theVenue)

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Header(model, venue, onClose)

        when (model.phase) {
            ReviewPhase.DID_YOU_GO -> DidYouGoStep(model, booking, api, onSubmitted, onClose)
            ReviewPhase.RATING -> StarRow(model.rating) { model.rating = it }
            ReviewPhase.DRINKS -> DrinkAccordion(model)
            ReviewPhase.DRINK_RATINGS -> DrinkRatingsStep(model)
            ReviewPhase.MUSIC -> MusicStep(model)
            ReviewPhase.CROWD -> StarRow(model.crowdRating) { model.crowdRating = it }
            ReviewPhase.WOULD_RETURN -> WouldReturnStep(model)
        }

        if (model.failed) {
            Text(
                stringResource(R.string.review_saveFailed),
                fontFamily = Geist, fontSize = 12.sp, color = Theme.wine,
            )
        }

        if (model.phase != ReviewPhase.DID_YOU_GO) {
            Spacer(Modifier.height(4.dp))
            PrimaryButton(
                title = stringResource(
                    if (model.isLastPhase) R.string.review_submit else R.string.review_continue,
                ),
                loading = model.submitting,
                enabled = model.canAdvance,
            ) {
                if (model.isLastPhase) {
                    model.submit(booking.id, api) {
                        onSubmitted(booking.id)
                        onClose()
                    }
                } else {
                    model.advance()
                }
            }
            Text(
                stringResource(R.string.common_cancel),
                fontFamily = Geist, fontSize = 13.sp, color = Theme.sand,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp)
                    .clickableUnlessBusy(onClick = onClose),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }

        Spacer(Modifier.height(12.dp))
    }
}

// ── Header ───────────────────────────────────────────────────────────────────

@Composable
private fun Header(model: ReviewSurveyViewModel, venue: String, onClose: () -> Unit) {
    val phase = model.phase

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.review_stepKicker, phase.ordinal + 1),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.8.sp,
                color = Theme.wine.copy(alpha = 0.7f),
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Filled.Close,
                contentDescription = stringResource(R.string.common_close),
                tint = Theme.stone,
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .clickableUnlessBusy(onClick = onClose)
                    .padding(7.dp),
            )
        }

        // Two lines, the second in italic — the serif break the whole brand
        // leans on. Kept as two resources rather than one so a translator can
        // choose where their own sentence breaks.
        Text(
            stringResource(
                when (phase) {
                    ReviewPhase.DID_YOU_GO -> R.string.review_titleDidYouGo
                    ReviewPhase.RATING -> R.string.review_titleOverall
                    ReviewPhase.DRINKS -> R.string.review_titleDrinks
                    ReviewPhase.DRINK_RATINGS -> R.string.review_titleDrinkRatings
                    ReviewPhase.MUSIC -> R.string.review_titleMusic
                    ReviewPhase.CROWD -> R.string.review_titleCrowd
                    ReviewPhase.WOULD_RETURN -> R.string.review_titleReturn
                },
            ),
            fontFamily = InstrumentSerif, fontSize = 34.sp, color = Theme.ink,
        )
        Text(
            when (phase) {
                ReviewPhase.DID_YOU_GO -> stringResource(R.string.review_subtitleDidYouGo, venue)
                ReviewPhase.RATING -> stringResource(R.string.review_subtitleOverall)
                ReviewPhase.DRINKS -> stringResource(R.string.review_subtitleDrinks)
                ReviewPhase.DRINK_RATINGS -> stringResource(R.string.review_subtitleDrinkRatings)
                ReviewPhase.MUSIC -> stringResource(R.string.review_subtitleMusic)
                ReviewPhase.CROWD -> stringResource(R.string.review_subtitleCrowd)
                ReviewPhase.WOULD_RETURN -> stringResource(R.string.review_subtitleReturn)
            },
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 34.sp, color = Theme.ink,
        )
        Text(
            stringResource(
                when (phase) {
                    ReviewPhase.DID_YOU_GO -> R.string.review_helpDidYouGo
                    ReviewPhase.RATING -> R.string.review_helpOverall
                    ReviewPhase.DRINKS -> R.string.review_helpDrinks
                    ReviewPhase.DRINK_RATINGS -> R.string.review_helpDrinkRatings
                    ReviewPhase.MUSIC -> R.string.review_helpMusic
                    ReviewPhase.CROWD -> R.string.review_helpCrowd
                    ReviewPhase.WOULD_RETURN -> R.string.review_helpReturn
                },
            ),
            fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
        )

        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ReviewPhase.entries.forEach { p ->
                Box(
                    Modifier
                        .weight(1f)
                        .height(2.dp)
                        .clip(CircleShape)
                        .background(if (p.ordinal <= phase.ordinal) Theme.wine else Theme.hairline),
                )
            }
        }
    }
}

// ── Steps ────────────────────────────────────────────────────────────────────

@Composable
private fun DidYouGoStep(
    model: ReviewSurveyViewModel,
    booking: Booking,
    api: ApiClient,
    onSubmitted: (String) -> Unit,
    onClose: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BigChoice(
            label = stringResource(R.string.review_yesIWent),
            icon = Icons.Filled.CheckCircle,
            enabled = !model.submitting,
        ) {
            model.recordWentIn(booking.id, api)
            model.advance()
        }
        BigChoice(
            label = stringResource(R.string.review_didntGo),
            icon = Icons.Filled.Close,
            enabled = !model.submitting,
        ) {
            model.sendDidNotGo(booking.id, api) {
                onSubmitted(booking.id)
                onClose()
            }
        }
    }
}

@Composable
private fun DrinkRatingsStep(model: ReviewSurveyViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        model.allDrinks.forEach { drink ->
            val stars = model.drinkRatings[drink] ?: 0
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Theme.surface)
                    .border(
                        1.dp,
                        if (stars > 0) Theme.wine.copy(alpha = 0.4f) else Theme.hairline,
                        RoundedCornerShape(14.dp),
                    )
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    drink,
                    fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                    fontSize = 18.sp, color = Theme.ink,
                )
                StarRow(stars, size = 26.dp, spacing = 6.dp) {
                    model.setDrinkRating(drink, it)
                }
            }
        }
    }
}

@Composable
private fun MusicStep(model: ReviewSurveyViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text(
            stringResource(R.string.review_howWasIt).uppercase(),
            fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
            color = Theme.fadedSand,
        )
        StarRow(model.musicRating) { model.musicRating = it }
        Text(
            stringResource(R.string.review_whatWasPlaying).uppercase(),
            fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
            color = Theme.fadedSand,
            modifier = Modifier.padding(top = 4.dp),
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MUSIC_GENRES.forEach { genre ->
                Chip(
                    label = genre,
                    selected = model.musicGenres[genre] == true,
                ) { model.toggleGenre(genre) }
            }
        }
    }
}

@Composable
private fun WouldReturnStep(model: ReviewSurveyViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf(
            "yes" to R.string.review_returnYes,
            "maybe" to R.string.review_returnMaybe,
            "no" to R.string.review_returnNo,
        ).forEach { (value, labelRes) ->
            val selected = model.wouldReturn == value
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (selected) Theme.wine else Theme.surface)
                    .then(
                        if (selected) Modifier
                        else Modifier.border(1.dp, Theme.hairline, RoundedCornerShape(12.dp)),
                    )
                    .clickableUnlessBusy { model.wouldReturn = value }
                    .padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (selected) {
                    Icon(
                        Icons.Filled.CheckCircle, contentDescription = null,
                        tint = Theme.cream, modifier = Modifier.size(14.dp),
                    )
                }
                Text(
                    stringResource(labelRes),
                    fontFamily = Geist,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 14.sp,
                    color = if (selected) Theme.cream else Theme.ink,
                )
            }
        }
    }
}

// ── The drink accordion ──────────────────────────────────────────────────────

@Composable
private fun DrinkAccordion(model: ReviewSurveyViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        DRINK_CATEGORIES.forEach { category ->
            val expanded = model.expandedCategory == category.key
            val count = model.countFor(category.key)
            val hasSelection = count > 0

            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Theme.surface)
                    .border(
                        if (hasSelection) 1.5.dp else 1.dp,
                        if (hasSelection) Theme.wine else Theme.hairline,
                        RoundedCornerShape(16.dp),
                    )
                    .animateContentSize(),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(
                            if (hasSelection) Theme.wine.copy(alpha = 0.06f) else Color.Transparent,
                        )
                        .clickableUnlessBusy { model.toggleCategory(category.key) }
                        .defaultMinSize(minHeight = 52.dp)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (hasSelection) {
                        Icon(
                            Icons.Filled.CheckCircle, contentDescription = null,
                            tint = Theme.wine, modifier = Modifier.size(14.dp),
                        )
                    }
                    Text(
                        stringResource(category.labelRes),
                        fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                        color = if (hasSelection) Theme.ink else Theme.stone,
                    )
                    if (count > 0) {
                        Text(
                            stringResource(R.string.review_nSelected, count).uppercase(),
                            fontFamily = GeistMono, fontSize = 8.5.sp, letterSpacing = 1.6.sp,
                            color = Theme.wine.copy(alpha = 0.7f),
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Icon(
                        if (expanded) Icons.Filled.KeyboardArrowUp
                        else Icons.Filled.KeyboardArrowDown,
                        contentDescription = null,
                        tint = Theme.sand,
                        modifier = Modifier.size(16.dp),
                    )
                }

                if (expanded) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .background(Theme.cream.copy(alpha = 0.6f))
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        if (category.items.isNotEmpty()) {
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                category.items.forEach { item ->
                                    Chip(
                                        label = item,
                                        selected = item in model.drinkPicks[category.key].orEmpty(),
                                        compact = true,
                                    ) { model.togglePick(category.key, item) }
                                }
                            }
                        }

                        // The escape hatch every controlled vocabulary needs.
                        val custom = model.drinkCustom[category.key].orEmpty()
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(38.dp)
                                .clip(CircleShape)
                                .background(Theme.surface)
                                .border(1.dp, Theme.hairline, CircleShape)
                                .padding(horizontal = 14.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (custom.isEmpty()) {
                                Text(
                                    stringResource(
                                        if (category.key == "other") R.string.review_typeAnything
                                        else R.string.review_addYourOwn,
                                    ),
                                    fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                                )
                            }
                            BasicTextField(
                                value = custom,
                                onValueChange = { model.setCustom(category.key, it) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(
                                    capitalization = KeyboardCapitalization.Words,
                                ),
                                textStyle = TextStyle(
                                    fontFamily = Geist, fontSize = 13.sp, color = Theme.ink,
                                ),
                                cursorBrush = SolidColor(Theme.wine),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
        }
    }
}

// ── Shared pieces ────────────────────────────────────────────────────────────

/** Tapping the lit star again clears the rating, so a misfire is recoverable. */
@Composable
private fun StarRow(
    value: Int,
    size: Dp = 32.dp,
    spacing: Dp = 8.dp,
    onChange: (Int) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
        (1..5).forEach { star ->
            val on = star <= value
            Icon(
                if (on) Icons.Filled.Star else Icons.Filled.StarBorder,
                contentDescription = null,
                tint = if (on) Theme.wine else Theme.fadedSand,
                modifier = Modifier
                    .size(size)
                    .clickableUnlessBusy { onChange(if (value == star) 0 else star) },
            )
        }
    }
}

@Composable
private fun Chip(
    label: String,
    selected: Boolean,
    compact: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .height(if (compact) 34.dp else 38.dp)
            .clip(CircleShape)
            .background(if (selected) Theme.wine else Theme.surface)
            .then(
                if (selected) Modifier
                else Modifier.border(1.dp, Theme.hairline, CircleShape),
            )
            .clickableUnlessBusy(onClick = onClick)
            .padding(horizontal = if (compact) 12.dp else 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (selected && compact) {
            Icon(
                Icons.Filled.Check, contentDescription = null,
                tint = Theme.cream, modifier = Modifier.size(10.dp),
            )
        }
        Text(
            label,
            fontFamily = Geist,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            fontSize = if (compact) 12.sp else 13.sp,
            color = if (selected) Theme.cream else Theme.ink,
        )
    }
}

@Composable
private fun BigChoice(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(60.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .border(1.dp, Theme.hairline, RoundedCornerShape(14.dp))
            .clickableUnlessBusy(enabled = enabled, onClick = onClick)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Theme.ink, modifier = Modifier.size(18.dp))
        Text(
            label,
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
            color = Theme.ink,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = Theme.sand,
            modifier = Modifier.size(16.dp),
        )
    }
}
