package com.clubfuoco.app.features.clubdetail

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.style.TextAlign
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
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.features.booking.BookNightSheet
import com.clubfuoco.app.features.rumbalist.FuocoScore
import com.clubfuoco.app.features.rumbalist.OfferSheet
import com.clubfuoco.app.features.rumbalist.RumbalistOffer
import com.clubfuoco.app.features.rumbalist.RumbalistOffers
import com.clubfuoco.app.models.ClubEvent
import com.clubfuoco.app.models.FeaturedDJ
import com.clubfuoco.app.models.Hours
import com.clubfuoco.app.models.Place
import com.clubfuoco.app.models.PlaceDetail
import java.net.URLEncoder
import java.util.Calendar

/**
 * Venue detail — port of the "cinema" club page: an edge-to-edge hero with the
 * name overlaid in white serif, a sheet that slides up over it, a four-stat fact
 * strip, "The Pitch", genre/tag chips, a photos strip, and the hours accordion.
 *
 * Deliberately NO standard paid "Book Your Night" button: the only user-facing
 * reservation paths are the Rumbalist offer cards on partner venues.
 */
@Composable
fun ClubDetailScreen(
    place: Place,
    queries: Queries,
    api: ApiClient,
    planDate: String,
    nightPhrase: String,
    hasAccount: Boolean,
    onNeedsAccount: () -> Unit,
    onOpenTickets: () -> Unit,
    onBack: () -> Unit,
) {
    var detail by remember(place.placeId) { mutableStateOf<PlaceDetail?>(null) }
    var hoursOpen by remember { mutableStateOf(false) }
    var activeOffer by remember { mutableStateOf<RumbalistOffer?>(null) }
    var events by remember(place.placeId) { mutableStateOf<List<ClubEvent>>(emptyList()) }
    var featuredDjs by remember(place.placeId) { mutableStateOf<List<FeaturedDJ>>(emptyList()) }
    var djById by remember(place.placeId) { mutableStateOf<Map<String, FeaturedDJ>>(emptyMap()) }
    var whatsOnExpanded by remember { mutableStateOf(false) }
    var booking by remember { mutableStateOf(false) }
    var activeDj by remember { mutableStateOf<FeaturedDJ?>(null) }
    var activeEvent by remember { mutableStateOf<ClubEvent?>(null) }
    val uriHandler = LocalUriHandler.current

    // Offers actually running on the planned night: the night must fall within
    // validDays AND not be one of the supplier's skipped dates. `liveOn` covers
    // both — `runsOn` alone would show a "Sun – Fri" offer on a Saturday, and
    // the server refuses that booking anyway.
    val offers = remember(place.placeId, planDate, RumbalistOffers.byClub) {
        RumbalistOffers.offers(place.placeId).filter { it.liveOn(planDate) }
    }

    LaunchedEffect(place.placeId) {
        // Independent of each other, so a failure on one side still renders the
        // other.
        detail = queries.clubById(place.placeId)
        val loadedEvents = queries.clubEvents(place.placeId)
        events = loadedEvents
        featuredDjs = queries.featuredDjs(place.placeId)

        // Resolve lineup credits to DJ pages by RA artist id — the exact join.
        val artistIds = loadedEvents.flatMap { it.credits }.mapNotNull { it.id }.distinct()
        djById = queries.djsByIds(artistIds).associateBy { it.raArtistId }
    }

    // Detail falls back to the feed Place, so the screen renders fully before
    // the richer row lands.
    val photos = detail?.photos?.takeIf { it.isNotEmpty() } ?: place.photos
    val genres = detail?.musicGenres ?: place.musicGenres
    val tags = detail?.tags ?: place.tags
    val weekdayHours = detail?.weekdayHours ?: place.weekdayHours
    val ratingsTotal = detail?.ratingsTotal ?: place.ratingsTotal
    val entryPrice = detail?.generalEntryPrice ?: place.generalEntryPrice
    val openStatus = detail?.isOpen ?: place.isOpen ?: Hours.computeOpenNow(weekdayHours)
    val ratingResult = FuocoScore.score(place.placeId, detail?.rating ?: place.rating)

    detail?.let { loaded ->
        if (booking) {
            BookNightSheet(
                detail = loaded,
                api = api,
                planDate = planDate,
                onOpenTickets = { booking = false; onOpenTickets() },
                onClose = { booking = false },
            )
            return
        }
    }

    // Which photo the fullscreen viewer is on, or null when it is closed.
    var viewerIndex by remember { mutableStateOf<Int?>(null) }

    viewerIndex?.let { start ->
        PhotoViewer(photos = photos, startIndex = start) { viewerIndex = null }
        return
    }

    Box(Modifier.fillMaxSize().background(Theme.surface)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {

            // ── Hero ────────────────────────────────────────────────────────
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(360.dp)
                    .clickableUnlessBusy(enabled = photos.isNotEmpty()) { viewerIndex = 0 },
            ) {
                FuocoImage(photos.firstOrNull(), Modifier.fillMaxSize())
                Box(
                    Modifier.fillMaxSize().background(
                        Brush.verticalGradient(
                            0.00f to Color.Black.copy(alpha = 0.48f),
                            0.35f to Color.Transparent,
                            0.45f to Color.Transparent,
                            1.00f to Color.Black.copy(alpha = 0.65f),
                        ),
                    ),
                )
                Column(
                    Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 20.dp, end = 20.dp, bottom = 44.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    genres.firstOrNull()?.let {
                        Text(
                            it.replace("_", " ").uppercase(),
                            fontFamily = GeistMono,
                            fontSize = 9.sp,
                            letterSpacing = 1.8.sp,
                            color = Color.White.copy(alpha = 0.65f),
                        )
                    }
                    Text(
                        place.name,
                        fontFamily = InstrumentSerif,
                        fontStyle = FontStyle.Italic,
                        fontSize = 38.sp,
                        color = Color.White,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        detail?.address ?: place.address,
                        fontFamily = Geist,
                        fontSize = 12.sp,
                        color = Color.White.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            // ── Sheet, slid up over the hero ────────────────────────────────
            Column(
                Modifier
                    .fillMaxWidth()
                    .offset(y = (-32).dp)
                    .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                    .background(Theme.surface)
                    .padding(bottom = 40.dp),
            ) {
                Box(
                    Modifier
                        .padding(top = 14.dp)
                        .align(Alignment.CenterHorizontally)
                        .width(36.dp)
                        .height(4.dp)
                        .clip(CircleShape)
                        .background(Theme.hairline),
                )

                FactStrip(
                    entryPrice = entryPrice,
                    ratingsTotal = ratingsTotal,
                    openStatus = openStatus,
                    rating = ratingResult.value,
                    boosted = ratingResult.boosted,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp),
                )

                detail?.description?.takeIf { it.isNotEmpty() }?.let { description ->
                    Pitch(description, Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp))
                }

                if (genres.isNotEmpty() || tags.isNotEmpty()) {
                    Chips(genres, tags, Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp))
                }

                if (photos.size > 1) {
                    PhotosStrip(
                        photos = photos,
                        onOpen = { viewerIndex = it },
                        modifier = Modifier.padding(top = 24.dp),
                    )
                }

                if (events.isNotEmpty() || featuredDjs.isNotEmpty()) {
                    WhatsOnSection(
                        events = events,
                        featuredDjs = featuredDjs,
                        djFor = { credit -> credit.id?.let { djById[it] } },
                        expanded = whatsOnExpanded,
                        onToggleExpanded = { whatsOnExpanded = !whatsOnExpanded },
                        onOpenDj = { activeDj = it },
                        onOpenEvent = { activeEvent = it },
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp),
                    )
                }

                // Booking the venue directly, as opposed to a promoter's offer
                // below. Only when the venue actually sells something — a row
                // with no price and no table minimum has nothing to book.
                if (detail != null &&
                    ((entryPrice ?: 0.0) > 0.0 || (detail?.vipTableMinSpend ?: 0.0) > 0.0)
                ) {
                    BookCta(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                        if (!hasAccount) onNeedsAccount() else booking = true
                    }
                }

                if (offers.isNotEmpty()) {
                    OffersSection(
                        offers = offers,
                        nightPhrase = nightPhrase,
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp),
                    ) { offer ->
                        if (!hasAccount) onNeedsAccount() else activeOffer = offer
                    }
                }

                if (weekdayHours.isNotEmpty()) {
                    HoursAccordion(
                        rows = weekdayHours,
                        openStatus = openStatus,
                        expanded = hoursOpen,
                        onToggle = { hoursOpen = !hoursOpen },
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp),
                    )
                }

                ActionRow(
                    place = place,
                    detail = detail,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp),
                    onOpen = { uriHandler.openUri(it) },
                )
            }
        }

        activeDj?.let { dj ->
            DjScreen(dj, queries) { activeDj = null }
            BackHandler { activeDj = null }
        }

        // Layered under the DJ page on purpose: opening an artist from a lineup
        // should not cost you the event you were reading it on, so closing the
        // DJ lands back here.
        if (activeDj == null) {
            activeEvent?.let { event ->
                EventDetailSheet(
                    event = event,
                    djFor = { credit -> credit.id?.let { djById[it] } },
                    onOpenDj = { activeDj = it },
                    onClose = { activeEvent = null },
                )
                BackHandler { activeEvent = null }
            }
        }

        activeOffer?.let { offer ->
            OfferSheet(
                offer = offer,
                clubId = place.placeId,
                venueName = place.name,
                venueAddress = detail?.address ?: place.address,
                planDate = planDate,
                api = api,
                onClose = { activeOffer = null },
            )
            BackHandler { activeOffer = null }
        }

        // Back button floats over the hero.
        if (activeOffer == null && activeDj == null && activeEvent == null) Box(
            Modifier
                .statusBarsPadding()
                .padding(start = 16.dp, top = 8.dp)
                .size(38.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.4f))
                .clickableUnlessBusy(onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.9f),
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

@Composable
private fun FactStrip(
    entryPrice: Double?,
    ratingsTotal: Int,
    openStatus: Boolean?,
    rating: Double?,
    boosted: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        FactTile(
            label = stringResource(R.string.detail_door),
            value = when {
                entryPrice == null -> "?"
                entryPrice == 0.0 -> stringResource(R.string.detail_free)
                else -> "€${entryPrice.toInt()}"
            },
            modifier = Modifier.weight(1f),
        )
        FactTile(
            label = stringResource(R.string.detail_reviewsLabel),
            value = when {
                ratingsTotal > 999 -> String.format("%.1fk", ratingsTotal / 1000.0)
                ratingsTotal > 0 -> "$ratingsTotal"
                else -> "—"
            },
            sub = if (ratingsTotal > 0) stringResource(R.string.detail_onGoogle) else null,
            modifier = Modifier.weight(1f),
        )
        FactTile(
            label = stringResource(R.string.detail_statusLabel),
            value = when (openStatus) {
                true -> stringResource(R.string.detail_open)
                false -> stringResource(R.string.detail_closed)
                null -> "—"
            },
            valueColor = when (openStatus) {
                true -> Theme.success
                false -> Theme.wine
                null -> Theme.fadedSand
            },
            modifier = Modifier.weight(1f),
        )
        FactTile(
            label = stringResource(R.string.detail_ratingLabel),
            value = rating?.let { String.format("%.1f", it) } ?: "—",
            // The label is what tells the user this is a house metric rather
            // than the Google rating in the tile beside it.
            sub = if (boosted) stringResource(R.string.detail_fuocoScore) else null,
            star = rating != null,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun FactTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    valueColor: Color = Theme.ink,
    star: Boolean = false,
) {
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Theme.cream)
            .padding(vertical = 12.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            label.uppercase(),
            fontFamily = GeistMono,
            fontSize = 9.sp,
            letterSpacing = 1.2.sp,
            color = Theme.fadedSand,
            textAlign = TextAlign.Center,
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (star) {
                Icon(
                    Icons.Filled.Star,
                    contentDescription = null,
                    tint = Theme.gold,
                    modifier = Modifier.size(11.dp),
                )
            }
            Text(
                value,
                fontFamily = Geist,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = valueColor,
            )
        }
        // Always reserve the sub row so labels and values line up across tiles.
        Text(
            sub ?: " ",
            fontFamily = Geist,
            fontSize = 9.sp,
            color = Theme.fadedSand,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Pitch(description: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            stringResource(R.string.detail_pitch).uppercase(),
            fontFamily = GeistMono,
            fontSize = 9.sp,
            letterSpacing = 1.6.sp,
            color = Theme.fadedSand,
        )
        Row {
            Box(Modifier.width(2.dp).height(80.dp).background(Theme.ink.copy(alpha = 0.16f)))
            Text(
                // No attribution line — "— <club name>" read as if the club
                // wrote its own pitch. Capped: a pitch is a punchy hook, not an
                // imported paragraph running half the screen.
                "“$description”",
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 18.sp,
                lineHeight = 24.sp,
                color = Theme.stone,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 14.dp),
            )
        }
    }
}

@Composable
private fun Chips(genres: List<String>, tags: List<String>, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.FlowRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        genres.forEach {
            Text(
                it.replace("_", " "),
                fontFamily = Geist,
                fontSize = 11.sp,
                color = Theme.wine,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Theme.wine.copy(alpha = 0.08f))
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }
        tags.take(4).forEach {
            Text(
                it.replace("_", " "),
                fontFamily = Geist,
                fontSize = 11.sp,
                color = Theme.fadedSand,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Theme.cream)
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun PhotosStrip(
    photos: List<String>,
    onOpen: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            stringResource(R.string.detail_photos).uppercase(),
            fontFamily = GeistMono,
            fontSize = 9.sp,
            letterSpacing = 1.6.sp,
            color = Theme.fadedSand,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp),
        ) {
            // Indexed against the FULL list, not the dropped one — the hero is
            // photo 0, so a thumbnail must open the viewer one further along or
            // every tap lands on the wrong picture.
            itemsIndexed(photos.drop(1)) { index, url ->
                FuocoImage(
                    url,
                    Modifier
                        .width(140.dp)
                        .height(100.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickableUnlessBusy { onOpen(index + 1) },
                    targetWidth = 140.dp,
                )
            }
        }
    }
}

@Composable
private fun HoursAccordion(
    rows: List<String>,
    openStatus: Boolean?,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Monday=0 … Sunday=6, matching the order Google's weekday_text arrives in.
    val todayIdx = remember {
        (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) + 5) % 7
    }

    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickableUnlessBusy(onClick = onToggle)
                .padding(vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Filled.Schedule,
                contentDescription = null,
                // Decorative, not an error — `accent` stays wine in light and
                // goes off-white in dark, where pure wine vanishes.
                tint = Theme.accent,
                modifier = Modifier.size(18.dp),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    stringResource(R.string.detail_openingHours).uppercase(),
                    fontFamily = GeistMono,
                    fontSize = 9.sp,
                    letterSpacing = 1.2.sp,
                    color = Theme.fadedSand,
                )
                Text(
                    when (openStatus) {
                        true -> stringResource(R.string.detail_openNow)
                        false -> stringResource(R.string.detail_closedNow)
                        null -> stringResource(R.string.detail_seeHours)
                    },
                    fontFamily = Geist,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = when (openStatus) {
                        true -> Theme.success
                        false -> Theme.stone
                        null -> Theme.ink
                    },
                )
            }
            Icon(
                Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = Theme.fadedSand,
                modifier = Modifier.size(18.dp),
            )
        }

        AnimatedVisibility(expanded) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Theme.cream),
            ) {
                rows.forEachIndexed { i, row ->
                    val isToday = i == todayIdx
                    val colon = row.indexOf(':')
                    val day = if (colon >= 0) row.substring(0, colon).trim() else row
                    val hours = if (colon >= 0) row.substring(colon + 1).trim() else ""
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(if (isToday) Theme.wine.copy(alpha = 0.09f) else Color.Transparent)
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    ) {
                        Text(
                            day,
                            fontFamily = Geist,
                            fontWeight = if (isToday) FontWeight.SemiBold else FontWeight.Normal,
                            fontSize = 13.sp,
                            color = if (isToday) Theme.wine else Theme.stone,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            hours,
                            fontFamily = Geist,
                            fontSize = 13.sp,
                            color = if (isToday) Theme.ink else Theme.stone,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionRow(
    place: Place,
    detail: PlaceDetail?,
    modifier: Modifier = Modifier,
    onOpen: (String) -> Unit,
) {
    val name = URLEncoder.encode(place.name, "UTF-8")
    val mapsUrl = "geo:${place.lat},${place.lng}?q=${place.lat},${place.lng}($name)"
    val uberUrl = "https://m.uber.com/ul/?action=setPickup&pickup=my_location" +
        "&dropoff%5Blatitude%5D=${place.lat}&dropoff%5Blongitude%5D=${place.lng}" +
        "&dropoff%5Bnickname%5D=$name"

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionPill(
                stringResource(R.string.detail_openMaps),
                Modifier.weight(1f),
            ) { onOpen(mapsUrl) }
            ActionPill("Uber", Modifier.weight(1f), dark = true) { onOpen(uberUrl) }
        }
        detail?.instagramUrl?.let { url ->
            ActionPill("Instagram", Modifier.fillMaxWidth()) { onOpen(url) }
        }
    }
}

@Composable
private fun ActionPill(
    title: String,
    modifier: Modifier = Modifier,
    dark: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(46.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (dark) Color(0xFF0A0A0A) else Theme.cream)
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            fontFamily = Geist,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = if (dark) Color.White else Theme.ink,
        )
    }
}

/**
 * The Rumbalist offer cards — the ONLY user-facing reservation path. There is
 * deliberately no generic "Book Your Night" button on this page.
 */
@Composable
private fun OffersSection(
    offers: List<RumbalistOffer>,
    nightPhrase: String,
    modifier: Modifier = Modifier,
    onOpen: (RumbalistOffer) -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                stringResource(R.string.rumbalist_bookVenue).uppercase(),
                fontFamily = GeistMono,
                fontSize = 9.sp,
                letterSpacing = 1.8.sp,
                color = Theme.fadedSand,
            )
            Text(
                // Tracks the When planner rather than always saying "tonight".
                stringResource(R.string.rumbalist_optionsFor, nightPhrase),
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 22.sp,
                color = Theme.ink,
            )
        }

        offers.forEach { offer -> OfferCard(offer) { onOpen(offer) } }

        Text(
            stringResource(R.string.rumbalist_confirmationNote),
            fontFamily = Geist,
            fontSize = 10.sp,
            color = Theme.fadedSand,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}

@Composable
private fun OfferCard(offer: RumbalistOffer, onClick: () -> Unit) {
    // Bronze rather than yellow gold on the VIP card: the ramp is pulled toward
    // copper while holding lightness, so the dark text stays readable on it.
    val vipInk = Color(0xFF2A1B08)
    val fg = if (offer.isVip) vipInk else Theme.ink

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .then(
                if (offer.isVip) {
                    Modifier.background(
                        Brush.linearGradient(
                            listOf(Color(0xFFF5D8AE), Color(0xFFE7BC80), Color(0xFFCF9B54)),
                        ),
                    )
                } else {
                    Modifier.background(Theme.cream)
                },
            )
            .clickableUnlessBusy(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    stringResource(
                        if (offer.isVip) R.string.rumbalist_titleVip
                        else R.string.rumbalist_titleFree,
                    ),
                    fontFamily = Geist,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = fg,
                    maxLines = 1,
                )
                // Credit the supplier behind THIS offer, per-offer rather than
                // app-wide, so a venue listing offers from different brands
                // credits each correctly.
                offer.brand?.let { brand ->
                    Text(
                        "· ${brand.name}",
                        fontFamily = Geist,
                        fontSize = 11.sp,
                        color = fg.copy(alpha = 0.75f),
                        maxLines = 1,
                    )
                }
            }
            Text(
                offer.subtitle,
                fontFamily = Geist,
                fontSize = 12.sp,
                color = if (offer.isVip) vipInk.copy(alpha = 0.7f) else Theme.stone,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Text(
            stringResource(if (offer.isVip) R.string.rumbalist_book else R.string.rumbalist_join),
            fontFamily = Geist,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            color = fg.copy(alpha = 0.9f),
            maxLines = 1,
        )
    }
}


/** The venue's own booking entry point, distinct from a promoter's offer. */
@Composable
private fun BookCta(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Theme.wine)
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            stringResource(R.string.book_cta),
            fontFamily = Geist,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            color = Theme.cream,
        )
    }
}
