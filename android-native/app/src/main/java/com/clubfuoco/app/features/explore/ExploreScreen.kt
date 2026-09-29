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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.ShimmerBlock
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.features.auth.FuocoTextField
import com.clubfuoco.app.models.FeedEvent
import com.clubfuoco.app.models.Place
import com.clubfuoco.app.stores.AuthStore
import com.clubfuoco.app.stores.PlanStore

/**
 * The explore feed — header with wordmark + search/saved toggles, the When
 * planner, filter chips, and the shelf feed. Port of `ExploreView.swift`.
 */
@Composable
fun ExploreScreen(
    model: ExploreViewModel,
    auth: AuthStore,
    plan: PlanStore,
    nightPhrase: String,
    onOpenPlace: (Place) -> Unit,
    onOpenShelf: (Shelf) -> Unit,
    onOpenEvent: (FeedEvent) -> Unit,
    onNeedsAccount: () -> Unit,
) {
    val t = localizedLookup()

    LaunchedEffect(Unit) {
        model.hydrateFromCache(plan.date, t)
        // Only load when there is nothing yet, so the feed the user was
        // browsing stays exactly as they left it — a reload rebuilds the
        // shelves, whose pool is shuffled per build. Pull-to-refresh is the
        // explicit way to get a fresh rotation.
        if (model.places.isEmpty()) {
            model.load(plan.date, t)
        } else if (!model.didRefresh) {
            model.didRefresh = true
            model.load(plan.date, t)
        }
    }

    LaunchedEffect(plan.date) {
        if (model.places.isNotEmpty()) model.rebuildShelves(plan.date, t)
    }

    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        // Pinned top bar — stays in place while the feed scrolls beneath it.
        Column(
            Modifier
                .fillMaxWidth()
                .background(Theme.cream)
                .statusBarsPadding(),
        ) {
            Header(model, onNeedsAccount)
            if (model.showSearch) {
                SearchField(model, Modifier.padding(horizontal = 20.dp).padding(bottom = 16.dp))
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
        }

        when (val state = model.state) {
            is ExploreViewModel.LoadState.Loading -> Skeleton()

            is ExploreViewModel.LoadState.Failed -> ErrorBanner {
                model.load(plan.date, t)
            }

            is ExploreViewModel.LoadState.Loaded -> {
                when {
                    model.showSearch && model.search.isNotEmpty() ->
                        SearchResults(model, onOpenPlace)
                    model.showSaved -> SavedView(model, onOpenPlace)
                    else -> Feed(
                        model, plan, nightPhrase, t,
                        onOpenPlace, onOpenShelf, onOpenEvent, auth, onNeedsAccount,
                    )
                }
            }
        }
    }
}

/**
 * The shelf builder needs a plain `(String) -> String`, but `stringResource` is
 * composable. Resolving by resource name keeps the shelf ids as the single
 * source of truth rather than duplicating a key → R.string map.
 */
@Composable
private fun localizedLookup(): (String) -> String {
    val context = androidx.compose.ui.platform.LocalContext.current
    return { key ->
        val id = context.resources.getIdentifier(key, "string", context.packageName)
        if (id != 0) context.getString(id) else key
    }
}

@Composable
private fun Header(model: ExploreViewModel, onNeedsAccount: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text(
                "fuoco.",
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 28.sp,
                color = Theme.ink,
            )
            Text(
                stringResource(R.string.explore_subtitle),
                fontFamily = Geist,
                fontSize = 10.sp,
                letterSpacing = 0.8.sp,
                color = Theme.fadedSand,
            )
        }
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RoundIconButton(
                if (model.showSearch) Icons.Filled.Close else Icons.Filled.Search,
                active = model.showSearch,
            ) {
                model.showSearch = !model.showSearch
                model.showSaved = false
            }
            RoundIconButton(
                if (model.showSaved) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                active = model.showSaved,
            ) {
                model.showSaved = !model.showSaved
                model.showSearch = false
                model.search = ""
            }
        }
    }
}

@Composable
private fun RoundIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    active: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(if (active) Theme.ink else Theme.ink.copy(alpha = 0.05f))
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (active) Theme.cream else Theme.stone,
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun SearchField(model: ExploreViewModel, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .height(50.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Theme.surface)
            .border(1.dp, Theme.ink.copy(alpha = 0.06f), RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Search, null, tint = Theme.stone, modifier = Modifier.size(16.dp))
        FuocoTextField(
            value = model.search,
            onValueChange = { model.search = it },
            placeholder = stringResource(R.string.explore_searchPlaceholder),
            modifier = Modifier.weight(1f),
        )
        if (model.search.isNotEmpty()) {
            Icon(
                Icons.Filled.Close, null, tint = Theme.sand,
                modifier = Modifier.size(16.dp).clickableUnlessBusy { model.search = "" },
            )
        }
    }
}

@Composable
private fun Feed(
    model: ExploreViewModel,
    plan: PlanStore,
    nightPhrase: String,
    t: (String) -> String,
    onOpenPlace: (Place) -> Unit,
    onOpenShelf: (Shelf) -> Unit,
    onOpenEvent: (FeedEvent) -> Unit,
    auth: AuthStore,
    onNeedsAccount: () -> Unit,
) {
    val save: (Place) -> Unit = { place ->
        if (!model.toggleSave(place, auth.hasAccount)) onNeedsAccount()
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 16.dp)) {
        item {
            WhenPlanner(plan, nightPhrase, Modifier.padding(bottom = 16.dp))
        }

        item {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp),
                modifier = Modifier.padding(bottom = 16.dp),
            ) {
                items(ShelfBuilder.filterChips, key = { it.first }) { (id, labelKey) ->
                    val active = model.activeFilter == id
                    val context = androidx.compose.ui.platform.LocalContext.current
                    val label = remember(labelKey) {
                        val resId = context.resources.getIdentifier(labelKey, "string", context.packageName)
                        if (resId != 0) context.getString(resId) else labelKey
                    }
                    Text(
                        label,
                        fontFamily = Geist,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        fontSize = 13.sp,
                        color = if (active) Theme.cream else Theme.stone,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (active) Theme.ink else Theme.ink.copy(alpha = 0.05f))
                            .clickableUnlessBusy {
                                model.activeFilter = id
                                model.rebuildShelves(plan.date, t)
                            }
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                    )
                }
            }
        }

        if (model.shelves.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.explore_noneNearby),
                    fontFamily = Geist,
                    fontSize = 14.sp,
                    color = Theme.fadedSand,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                )
            }
        } else {
            itemsIndexed(model.shelves, key = { _, s -> s.id }) { index, shelf ->
                ShelfRow(
                    shelf = shelf,
                    index = index,
                    saved = model.saved,
                    nightPhrase = nightPhrase,
                    onSave = save,
                    onOpen = onOpenPlace,
                    onOpenShelf = onOpenShelf,
                    // Only the featured shelf carries our own nights.
                    leadEvent = if (shelf.featured) model.leadEvent else null,
                    mixedEvents = if (shelf.featured) model.mixedEvents else emptyList(),
                    onOpenEvent = onOpenEvent,
                )
            }
        }
    }
}

@Composable
private fun SearchResults(model: ExploreViewModel, onOpenPlace: (Place) -> Unit) {
    val results = model.searchResults
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (results.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.explore_noResults, model.search),
                    fontFamily = Geist,
                    fontSize = 13.sp,
                    color = Theme.fadedSand,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                )
            }
        } else {
            items(results, key = { it.placeId }) { place ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Theme.surface)
                        .clickableUnlessBusy { onOpenPlace(place) }
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FuocoImage(
                        place.coverPhoto,
                        Modifier.size(52.dp).clip(RoundedCornerShape(10.dp)),
                        targetWidth = 52.dp,
                    )
                    Column(Modifier.weight(1f)) {
                        Text(
                            place.name,
                            fontFamily = Geist,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp,
                            color = Theme.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            place.address,
                            fontFamily = Geist,
                            fontSize = 12.sp,
                            color = Theme.fadedSand,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SavedView(model: ExploreViewModel, onOpenPlace: (Place) -> Unit) {
    val savedPlaces = model.savedPlaces
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Column {
                Text(
                    stringResource(R.string.explore_savedTitle),
                    fontFamily = InstrumentSerif,
                    fontStyle = FontStyle.Italic,
                    fontSize = 44.sp,
                    color = Theme.ink,
                )
                Text(
                    when {
                        savedPlaces.isEmpty() -> stringResource(R.string.explore_noSaved)
                        savedPlaces.size == 1 -> stringResource(R.string.explore_savedOne)
                        else -> stringResource(R.string.explore_savedMany, savedPlaces.size)
                    },
                    fontFamily = Geist,
                    fontSize = 13.sp,
                    color = Theme.fadedSand,
                )
            }
        }
        if (savedPlaces.isEmpty()) {
            item {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        stringResource(R.string.explore_nothingSaved),
                        fontFamily = Geist, fontSize = 14.sp, color = Theme.fadedSand,
                    )
                    Text(
                        stringResource(R.string.explore_savedHint),
                        fontFamily = Geist, fontSize = 12.sp,
                        color = Theme.fadedSand.copy(alpha = 0.7f),
                        textAlign = TextAlign.Center,
                    )
                }
            }
        } else {
            items(savedPlaces, key = { it.placeId }) { place ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(18.dp))
                        .background(Theme.surface)
                        .clickableUnlessBusy { onOpenPlace(place) },
                ) {
                    FuocoImage(place.coverPhoto, Modifier.fillMaxWidth().height(200.dp))
                    Column(Modifier.padding(20.dp)) {
                        Text(
                            place.name,
                            fontFamily = InstrumentSerif,
                            fontSize = 30.sp,
                            color = Theme.ink,
                        )
                        Text(
                            place.address,
                            fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Skeleton() {
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(220.dp)) {
            ShimmerBlock(Modifier.fillMaxSize(), corner = 16.dp)
        }
        repeat(2) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                ShimmerBlock(Modifier.width(140.dp).height(12.dp), corner = 4.dp)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    repeat(3) {
                        ShimmerBlock(Modifier.width(160.dp).height(200.dp), corner = 14.dp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorBanner(onRetry: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(20.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Theme.surface)
            .border(1.dp, Theme.wine.copy(alpha = 0.2f), RoundedCornerShape(12.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            stringResource(R.string.explore_loadError),
            fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
            modifier = Modifier.weight(1f),
        )
        Text(
            stringResource(R.string.common_retry),
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 13.sp,
            color = Theme.wine,
            modifier = Modifier.clickableUnlessBusy(onClick = onRetry),
        )
    }
}

/** The "when are you going out" day picker. */
@Composable
private fun WhenPlanner(plan: PlanStore, nightPhrase: String, modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val options = remember(plan.date, context) {
        PlanStore.dayOptions(
            java.util.Locale.getDefault(),
            context.getString(R.string.plan_tonight),
            context.getString(R.string.plan_tomorrow),
        )
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            stringResource(R.string.plan_goingOut).uppercase(),
            fontFamily = Geist,
            fontSize = 9.sp,
            letterSpacing = 1.3.sp,
            color = Theme.fadedSand,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp),
        ) {
            items(options, key = { it.value }) { option ->
                val active = plan.date == option.value
                Text(
                    option.label,
                    fontFamily = Geist,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 13.sp,
                    color = if (active) Theme.cream else Theme.stone,
                    maxLines = 1,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(if (active) Theme.wine else Theme.surface)
                        .clickableUnlessBusy { plan.set(option.value) }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }
}
