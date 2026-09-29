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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.features.rumbalist.FuocoScore
import com.clubfuoco.app.models.Place

/**
 * The full list behind a shelf's "N venues →" header. Port of `ShelfListView`.
 */
@Composable
fun ShelfListScreen(
    shelf: Shelf,
    saved: Set<String>,
    onBack: () -> Unit,
    onOpenPlace: (Place) -> Unit,
    onSave: (Place) -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        Column(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            BackChevronButton(onClick = onBack)
            Text(
                shelf.subtitle.uppercase(),
                fontFamily = Geist,
                fontSize = 9.sp,
                letterSpacing = 1.3.sp,
                color = Theme.fadedSand,
            )
            Text(
                shelf.title,
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 34.sp,
                color = Theme.ink,
            )
        }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp, end = 20.dp, bottom = 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(shelf.places, key = { it.placeId }) { place ->
                ShelfListRow(
                    place = place,
                    isSaved = place.placeId in saved,
                    onOpen = { onOpenPlace(place) },
                    onSave = { onSave(place) },
                )
            }
        }
    }
}

@Composable
private fun ShelfListRow(
    place: Place,
    isSaved: Boolean,
    onOpen: () -> Unit,
    onSave: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .clickableUnlessBusy(onClick = onOpen)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FuocoImage(
            place.coverPhoto,
            Modifier.size(72.dp).clip(RoundedCornerShape(12.dp)),
            targetWidth = 72.dp,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
                place.neighborhood ?: place.address,
                fontFamily = Geist,
                fontSize = 12.sp,
                color = Theme.fadedSand,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FuocoScore.score(place.placeId, place.rating).value?.let { rating ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        Icon(
                            Icons.Filled.Star,
                            contentDescription = null,
                            tint = Theme.gold,
                            modifier = Modifier.size(11.dp),
                        )
                        Text(
                            String.format("%.1f", rating),
                            fontFamily = Geist,
                            fontSize = 11.sp,
                            color = Theme.stone,
                        )
                    }
                }
                place.distance?.let {
                    Text(
                        ExploreViewModel.formatDistance(it),
                        fontFamily = Geist,
                        fontSize = 11.sp,
                        color = Theme.fadedSand,
                    )
                }
                if (place.isOpen == true) {
                    Text(
                        stringResource(R.string.explore_open).uppercase(),
                        fontFamily = Geist,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 8.sp,
                        letterSpacing = 1.sp,
                        color = androidx.compose.ui.graphics.Color.White,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Theme.success)
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                    )
                }
            }
        }
        Box(
            Modifier.size(44.dp).clickableUnlessBusy(onClick = onSave),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (isSaved) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                contentDescription = null,
                tint = if (isSaved) Theme.wine else Theme.sand,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
