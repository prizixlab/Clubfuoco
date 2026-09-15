package com.clubfuoco.app.features.friends

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.features.auth.FuocoTextField
import com.clubfuoco.app.models.FriendSearchResult
import com.clubfuoco.app.models.FriendUser

/**
 * Friends — live search, add, respond to requests, remove. Port of
 * `FriendsView`.
 */
@Composable
fun FriendsScreen(api: ApiClient, onBack: () -> Unit) {
    val model: FriendsViewModel = viewModel()
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { model.load(api) }
    LaunchedEffect(query) { model.search(query, api) }

    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        Column(
            Modifier
                .statusBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            BackChevronButton(onClick = onBack)
            Text(
                stringResource(R.string.profile_friends),
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 34.sp,
                color = Theme.ink,
            )
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Theme.surface)
                    .border(1.dp, Theme.hairline, RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Filled.Search, null, tint = Theme.stone, modifier = Modifier.size(16.dp))
                FuocoTextField(
                    query, { query = it },
                    Modifier.weight(1f),
                    placeholder = stringResource(R.string.friends_searchPlaceholder),
                )
            }
        }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp, end = 20.dp, bottom = 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (query.isNotBlank()) {
                if (model.results.isEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.friends_noneFound, query),
                            fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                            modifier = Modifier.padding(vertical = 20.dp),
                        )
                    }
                }
                items(model.results, key = { it.id }) { result ->
                    SearchRow(result) { model.add(result.id, api) }
                }
            } else {
                if (model.data.incoming.isNotEmpty()) {
                    item { Kicker(stringResource(R.string.friends_requests), color = Theme.wine) }
                    items(model.data.incoming, key = { "in-${it.id}" }) { user ->
                        FriendRow(
                            user = user,
                            actionLabel = stringResource(R.string.friends_accept),
                            onAction = { model.respond(user.friendshipId, accept = true, api = api) },
                            secondaryLabel = stringResource(R.string.friends_decline),
                            onSecondary = { model.respond(user.friendshipId, accept = false, api = api) },
                        )
                    }
                }

                item { Kicker(stringResource(R.string.friends_yourFriends), color = Theme.fadedSand) }
                if (model.data.friends.isEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.friends_empty),
                            fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                            modifier = Modifier.padding(vertical = 20.dp),
                        )
                    }
                }
                items(model.data.friends, key = { "f-${it.id}" }) { user ->
                    FriendRow(
                        user = user,
                        actionLabel = null,
                        onAction = {},
                        // Icon rather than a labelled button, matching iOS —
                        // and there is no "Remove" string in the catalog.
                        trailingIcon = Icons.Filled.PersonRemove,
                        onTrailingIcon = { model.remove(user.friendshipId, api) },
                    )
                }

                if (model.data.outgoing.isNotEmpty()) {
                    item { Kicker(stringResource(R.string.friends_pending), color = Theme.fadedSand) }
                    items(model.data.outgoing, key = { "out-${it.id}" }) { user ->
                        FriendRow(user = user, actionLabel = null, onAction = {})
                    }
                }
            }
        }
    }
}

@Composable
private fun Avatar(url: String?, initials: String) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(Theme.wine.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) {
            FuocoImage(url, Modifier.size(44.dp).clip(CircleShape), targetWidth = 44.dp)
        } else {
            Text(
                initials,
                fontFamily = InstrumentSerif, fontSize = 18.sp, color = Theme.wine,
            )
        }
    }
}

@Composable
private fun FriendRow(
    user: FriendUser,
    actionLabel: String?,
    onAction: () -> Unit,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    trailingIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    onTrailingIcon: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(user.avatarUrl, user.initials)
        Text(
            user.fullName ?: "—",
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
            color = Theme.ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        secondaryLabel?.let { label ->
            Pill(label, filled = false) { onSecondary?.invoke() }
        }
        actionLabel?.let { label ->
            Pill(label, filled = secondaryLabel != null, onClick = onAction)
        }
        trailingIcon?.let { icon ->
            Icon(
                icon,
                contentDescription = null,
                tint = Theme.fadedSand,
                modifier = Modifier
                    .size(36.dp)
                    .clickableUnlessBusy { onTrailingIcon?.invoke() }
                    .padding(8.dp),
            )
        }
    }
}

@Composable
private fun SearchRow(result: FriendSearchResult, onAdd: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Theme.surface)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(result.avatarUrl, result.initials)
        Text(
            result.fullName ?: "—",
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
            color = Theme.ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        when (result.relation) {
            "friends" -> Text(
                stringResource(R.string.friends_added),
                fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
            )
            "outgoing" -> Text(
                stringResource(R.string.friends_requested),
                fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
            )
            else -> Pill(stringResource(R.string.friends_add), filled = true, onClick = onAdd)
        }
    }
}

@Composable
private fun Pill(label: String, filled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontFamily = Geist,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        color = if (filled) Theme.cream else Theme.wine,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (filled) Theme.wine else Theme.wine.copy(alpha = 0.10f))
            .clickableUnlessBusy(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    )
}
