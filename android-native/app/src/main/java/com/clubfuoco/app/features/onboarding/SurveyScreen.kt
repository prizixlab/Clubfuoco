package com.clubfuoco.app.features.onboarding

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.DRINK_CATEGORIES
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.SegmentedProgress
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient

/**
 * The onboarding preferences survey — port of `SurveyView`.
 *
 * Seven questions (music · vibe · drinks · nights · budget · squad · crowd) that
 * become the input to `PersonalizationScore`. Without them the Explore feed can
 * only rank by distance and opening hours, which is the same feed for everyone
 * in the city.
 *
 * Every step can be skipped and the save never blocks entry, so the worst case
 * is a generic feed rather than a locked door.
 */
@Composable
fun SurveyScreen(
    api: ApiClient,
    onComplete: () -> Unit,
    onCancel: () -> Unit,
) {
    val model: SurveyViewModel = viewModel()
    val total = SurveyStepKey.entries.size

    BackHandler { if (model.isFirst) onCancel() else model.back() }

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BackChevronButton { if (model.isFirst) onCancel() else model.back() }
            Spacer(Modifier.weight(1f))
            Text(
                "%02d / %02d".format(model.stepIndex + 1, total),
                fontFamily = GeistMono, fontSize = 8.5.sp, letterSpacing = 1.9.sp,
                color = Theme.fadedSand,
            )
        }

        SegmentedProgress(
            step = model.stepIndex + 1,
            total = total,
            modifier = Modifier.padding(bottom = 24.dp),
        )

        Kicker(
            stringResource(kickerFor(model.step), model.stepIndex + 1),
            modifier = Modifier.padding(bottom = 12.dp),
        )

        Text(
            stringResource(titleFor(model.step)),
            fontFamily = InstrumentSerif, fontSize = 46.sp, lineHeight = 48.sp,
            color = Theme.ink,
        )
        Text(
            stringResource(italicFor(model.step)),
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 46.sp, lineHeight = 48.sp, color = Theme.ink,
            modifier = Modifier.padding(bottom = 6.dp),
        )

        Row(Modifier.padding(bottom = 28.dp)) {
            Text(
                stringResource(subtitleFor(model.step)),
                fontFamily = Geist, fontSize = 13.5.sp, color = Theme.stone,
            )
            // The running count is the only thing that makes the cap legible
            // before someone hits it.
            if (model.step == SurveyStepKey.VIBES) {
                Text(
                    "  · ${model.vibes.size}/${SurveyViewModel.VIBE_CAP}",
                    fontFamily = Geist, fontSize = 13.5.sp, color = Theme.sand,
                )
            }
        }

        Box(Modifier.padding(bottom = 28.dp)) {
            when (model.step) {
                SurveyStepKey.MUSIC -> ChipsWithCustom(
                    options = model.musicWithCustom,
                    isSelected = model::isSelected,
                    onToggle = model::toggle,
                    placeholder = stringResource(R.string.survey_addGenre),
                    onAdd = model::addCustomMusic,
                )

                SurveyStepKey.VIBES -> ChipsWithCustom(
                    options = model.vibesWithCustom,
                    isSelected = model::isSelected,
                    onToggle = model::toggle,
                    placeholder = stringResource(R.string.survey_addVibe),
                    onAdd = model::addCustomVibe,
                )

                SurveyStepKey.DRINKS -> DrinksAccordion(model)

                SurveyStepKey.NIGHTS -> OptionChips(
                    options = SurveyViewModel.NIGHT_OPTIONS,
                    isSelected = model::isSelected,
                    onToggle = model::toggle,
                )

                SurveyStepKey.BUDGET -> BudgetStep(model)

                SurveyStepKey.SQUAD -> SquadStep(model)

                SurveyStepKey.CROWD -> OptionChips(
                    options = SurveyViewModel.CROWD_OPTIONS,
                    isSelected = model::isSelected,
                    onToggle = model::toggle,
                )
            }
        }

        PrimaryButton(
            title = stringResource(
                if (model.isLast) R.string.survey_letsGo else R.string.review_continue,
            ),
            loading = model.saving,
            enabled = model.canAdvance,
        ) { model.advance(api, onComplete) }

        Text(
            stringResource(R.string.survey_skipForNow),
            fontFamily = Geist, fontSize = 13.sp, color = Theme.sand,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp)
                .clickableUnlessBusy(enabled = !model.saving) { onComplete() },
        )

        Spacer(Modifier.height(20.dp))
    }
}

// ── Copy lookup ──────────────────────────────────────────────────────────────
// Split plain / italic / help per step so a translator can break their own
// sentence where it reads, rather than where English happens to.

private fun kickerFor(step: SurveyStepKey) = when (step) {
    SurveyStepKey.MUSIC -> R.string.survey_kickerMusic
    SurveyStepKey.VIBES -> R.string.survey_kickerVibes
    SurveyStepKey.DRINKS -> R.string.survey_kickerDrinks
    SurveyStepKey.NIGHTS -> R.string.survey_kickerNights
    SurveyStepKey.BUDGET -> R.string.survey_kickerBudget
    SurveyStepKey.SQUAD -> R.string.survey_kickerSquad
    SurveyStepKey.CROWD -> R.string.survey_kickerCrowd
}

private fun titleFor(step: SurveyStepKey) = when (step) {
    SurveyStepKey.MUSIC -> R.string.survey_titleMusic
    SurveyStepKey.VIBES -> R.string.survey_titleVibes
    SurveyStepKey.DRINKS -> R.string.survey_titleDrinks
    SurveyStepKey.NIGHTS -> R.string.survey_titleNights
    SurveyStepKey.BUDGET -> R.string.survey_titleBudget
    SurveyStepKey.SQUAD -> R.string.survey_titleSquad
    SurveyStepKey.CROWD -> R.string.survey_titleCrowd
}

private fun italicFor(step: SurveyStepKey) = when (step) {
    SurveyStepKey.MUSIC -> R.string.survey_italicMusic
    SurveyStepKey.VIBES -> R.string.survey_italicVibes
    SurveyStepKey.DRINKS -> R.string.survey_italicDrinks
    SurveyStepKey.NIGHTS -> R.string.survey_italicNights
    SurveyStepKey.BUDGET -> R.string.survey_italicBudget
    SurveyStepKey.SQUAD -> R.string.survey_italicSquad
    SurveyStepKey.CROWD -> R.string.survey_italicCrowd
}

private fun subtitleFor(step: SurveyStepKey) = when (step) {
    SurveyStepKey.MUSIC -> R.string.survey_subMusic
    SurveyStepKey.VIBES -> R.string.survey_subVibes
    SurveyStepKey.DRINKS -> R.string.survey_subDrinks
    SurveyStepKey.NIGHTS -> R.string.survey_subNights
    SurveyStepKey.BUDGET -> R.string.survey_subBudget
    SurveyStepKey.SQUAD -> R.string.survey_subSquad
    SurveyStepKey.CROWD -> R.string.survey_subCrowd
}

// ── Steps ────────────────────────────────────────────────────────────────────

@Composable
private fun OptionChips(
    options: List<SurveyOption>,
    isSelected: (String) -> Boolean,
    onToggle: (String) -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        options.forEach { option ->
            SurveyChip(
                label = option.literal ?: stringResource(option.labelRes!!),
                selected = isSelected(option.value),
            ) { onToggle(option.value) }
        }
    }
}

@Composable
private fun ChipsWithCustom(
    options: List<SurveyOption>,
    isSelected: (String) -> Boolean,
    onToggle: (String) -> Unit,
    placeholder: String,
    onAdd: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        OptionChips(options, isSelected, onToggle)
        // Anything typed here comes back as a normal chip, so it can be
        // un-picked like any other — a custom answer that could only be added
        // and never removed would be a trap.
        CustomEntry(placeholder = placeholder, onAdd = onAdd)
    }
}

@Composable
private fun CustomEntry(placeholder: String, onAdd: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val ready = text.trim().isNotEmpty()

    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier
                .weight(1f)
                .height(42.dp)
                .clip(CircleShape)
                .background(Theme.surface)
                .border(1.dp, Theme.hairline, CircleShape)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (text.isEmpty()) {
                Text(
                    placeholder,
                    fontFamily = Geist, fontSize = 14.sp, color = Theme.fadedSand,
                )
            }
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Words,
                ),
                textStyle = TextStyle(fontFamily = Geist, fontSize = 14.sp, color = Theme.ink),
                cursorBrush = SolidColor(Theme.wine),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Box(
            Modifier
                .height(42.dp)
                .clip(CircleShape)
                .background(if (ready) Theme.wine else Theme.surface)
                .then(
                    if (ready) Modifier
                    else Modifier.border(1.dp, Theme.hairline, CircleShape),
                )
                .clickableUnlessBusy(enabled = ready) { onAdd(text); text = "" }
                .padding(horizontal = 18.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                stringResource(R.string.survey_add),
                fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 13.sp,
                color = if (ready) Theme.cream else Theme.sand,
            )
        }
    }
}

@Composable
private fun BudgetStep(model: SurveyViewModel) {
    val noLimit = model.budget >= SurveyViewModel.BUDGET_NO_LIMIT

    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text(
            if (noLimit) stringResource(R.string.survey_noLimit) else "€${model.budget}",
            fontFamily = InstrumentSerif, fontSize = 40.sp, color = Theme.ink,
        )

        // Hidden at "no limit": a slider showing a number that is not the answer
        // is worse than no slider.
        if (!noLimit) {
            Slider(
                value = model.budget.coerceAtMost(SurveyViewModel.BUDGET_MAX).toFloat(),
                onValueChange = { model.budget = (it / 5).toInt() * 5 },
                valueRange = 10f..SurveyViewModel.BUDGET_MAX.toFloat(),
                steps = (SurveyViewModel.BUDGET_MAX - 10) / 5 - 1,
                colors = SliderDefaults.colors(
                    thumbColor = Theme.wine,
                    activeTrackColor = Theme.wine,
                    inactiveTrackColor = Theme.hairline,
                ),
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                SurveyViewModel.BUDGET_PRESETS.forEach { value ->
                    SurveyChip(
                        label = "€$value",
                        selected = model.budget == value,
                        modifier = Modifier.weight(1f),
                        height = 38.dp,
                    ) { model.budget = value }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                SurveyChip(
                    label = stringResource(R.string.survey_noLimit),
                    selected = noLimit,
                    height = 38.dp,
                ) { model.budget = SurveyViewModel.BUDGET_NO_LIMIT }
            }
        }
    }
}

@Composable
private fun SquadStep(model: SurveyViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SurveyViewModel.SQUAD_OPTIONS.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { option ->
                    val selected = model.squad == option.value
                    Column(
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = 84.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (selected) Theme.wine else Theme.surface)
                            .then(
                                if (selected) Modifier
                                else Modifier.border(1.dp, Theme.hairline, RoundedCornerShape(16.dp)),
                            )
                            .clickableUnlessBusy { model.squad = option.value }
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            stringResource(option.labelRes!!),
                            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                            fontSize = 24.sp,
                            color = if (selected) Theme.cream else Theme.ink,
                        )
                        Text(
                            stringResource(option.subRes!!),
                            fontFamily = Geist, fontSize = 11.sp,
                            color = if (selected) Theme.cream.copy(alpha = 0.8f) else Theme.stone,
                        )
                    }
                }
            }
        }
    }
}

// ── Drinks accordion ─────────────────────────────────────────────────────────

@Composable
private fun DrinksAccordion(model: SurveyViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        DRINK_CATEGORIES.forEach { category ->
            val expanded = model.expandedCategory == category.key
            val hasSelection = model.hasSelection(category.key)
            val dontCare = model.isDontCare(category.key)
            val count = model.selectedCountFor(category.key)

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
                    when {
                        dontCare -> Text(
                            stringResource(R.string.survey_any).uppercase(),
                            fontFamily = GeistMono, fontSize = 8.5.sp, letterSpacing = 1.6.sp,
                            color = Theme.sand,
                        )
                        count > 0 -> Text(
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
                        val custom = model.customItemsFor(category.key)
                        if (category.items.isNotEmpty() || custom.isNotEmpty()) {
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                (category.items + custom).forEach { item ->
                                    DrinkPill(item, item in model.drinks) {
                                        if (item in model.drinks) model.drinks.remove(item)
                                        else model.drinks.add(item)
                                    }
                                }
                            }
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val text = model.customDrinkInput[category.key].orEmpty()
                            val ready = text.trim().isNotEmpty() && text.trim() !in model.drinks
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(38.dp)
                                    .clip(CircleShape)
                                    .background(Theme.surface)
                                    .border(1.dp, Theme.hairline, CircleShape)
                                    .padding(horizontal = 14.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                if (text.isEmpty()) {
                                    Text(
                                        stringResource(
                                            if (category.key == "other") R.string.review_typeAnything
                                            else R.string.review_addYourOwn,
                                        ),
                                        fontFamily = Geist, fontSize = 13.sp,
                                        color = Theme.fadedSand,
                                    )
                                }
                                BasicTextField(
                                    value = text,
                                    onValueChange = { model.customDrinkInput[category.key] = it },
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
                            Box(
                                Modifier
                                    .height(38.dp)
                                    .clip(CircleShape)
                                    .background(if (ready) Theme.wine else Theme.surface)
                                    .then(
                                        if (ready) Modifier
                                        else Modifier.border(1.dp, Theme.hairline, CircleShape),
                                    )
                                    .clickableUnlessBusy(enabled = ready) {
                                        model.addCustomDrink(category.key)
                                    }
                                    .padding(horizontal = 14.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    stringResource(R.string.survey_add),
                                    fontFamily = Geist, fontWeight = FontWeight.Medium,
                                    fontSize = 12.sp,
                                    color = if (ready) Theme.cream else Theme.sand,
                                )
                            }
                        }

                        // "Other" has no presets to be indifferent about.
                        if (category.key != "other") {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(36.dp)
                                    .clip(CircleShape)
                                    .background(
                                        if (dontCare) Theme.wine.copy(alpha = 0.08f)
                                        else Color.Transparent,
                                    )
                                    .border(
                                        1.dp,
                                        if (dontCare) Theme.wine.copy(alpha = 0.4f)
                                        else Theme.hairline,
                                        CircleShape,
                                    )
                                    .clickableUnlessBusy { model.setDontCare(category.key) },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    stringResource(R.string.survey_dontCare).uppercase(),
                                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.6.sp,
                                    color = if (dontCare) Theme.wine else Theme.sand,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DrinkPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .height(34.dp)
            .clip(CircleShape)
            .background(if (selected) Theme.wine else Theme.surface)
            .then(
                if (selected) Modifier else Modifier.border(1.dp, Theme.hairline, CircleShape),
            )
            .clickableUnlessBusy(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (selected) {
            Icon(
                Icons.Filled.Check, contentDescription = null,
                tint = Theme.cream, modifier = Modifier.size(10.dp),
            )
        }
        Text(
            label,
            fontFamily = Geist,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            fontSize = 12.sp,
            color = if (selected) Theme.cream else Theme.ink,
        )
    }
}

@Composable
private fun SurveyChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 42.dp,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(height)
            .clip(CircleShape)
            .background(if (selected) Theme.wine else Theme.surface)
            .then(
                if (selected) Modifier else Modifier.border(1.dp, Theme.hairline, CircleShape),
            )
            .clickableUnlessBusy(onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontFamily = Geist,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            fontSize = 14.sp,
            maxLines = 1,
            color = if (selected) Theme.cream else Theme.ink,
        )
    }
}
