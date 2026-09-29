package com.clubfuoco.app.features.inviteclaim

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.FriendUser
import com.clubfuoco.app.models.FriendsData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Single-select friend picker used to fill one invite slot.
 *
 * Friends already on a slot — or already going under their own name — are
 * excluded, so a slot can never be spent twice on the same person. Port of
 * `FriendPickerSheet`.
 */
@Composable
fun FriendPickerSheet(
    api: ApiClient,
    excluded: Set<String>,
    onPick: (FriendUser) -> Unit,
    onClose: () -> Unit,
) {
    var friends by remember { mutableStateOf<List<FriendUser>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        friends = runCatching {
            withContext(Dispatchers.IO) { api.get("/api/friends", FriendsData.serializer()) }
        }.getOrNull()?.friends.orEmpty()
        loading = false
    }

    val filtered = remember(friends, excluded, query) {
        val available = friends.filterNot { excluded.contains(it.id) }
        val q = query.trim().lowercase()
        if (q.isEmpty()) available
        else available.filter { it.fullName.orEmpty().lowercase().contains(q) }
    }

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(FuocoFixed.night)
            .statusBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.invite_pickFriend),
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 24.sp, color = FuocoFixed.parchment,
                modifier = Modifier.weight(1f),
            )
            Text(
                stringResource(R.string.common_close),
                fontFamily = Geist, fontSize = 14.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.7f),
                modifier = Modifier.clickableUnlessBusy(onClick = onClose),
            )
        }

        // Search — only worth the space once the list is long enough to need it.
        if (friends.size > 6) {
            Box(
                Modifier
                    .padding(horizontal = 20.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                if (query.isEmpty()) {
                    Text(
                        stringResource(R.string.invite_searchFriends),
                        fontFamily = Geist, fontSize = 14.sp,
                        color = FuocoFixed.parchment.copy(alpha = 0.4f),
                    )
                }
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = TextStyle(
                        fontFamily = Geist, fontSize = 14.sp, color = FuocoFixed.parchment,
                    ),
                    cursorBrush = SolidColor(Theme.gold),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        when {
            loading -> Unit

            filtered.isEmpty() -> Column(
                Modifier.fillMaxSize().padding(40.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    stringResource(
                        if (friends.isEmpty()) R.string.invite_noFriends
                        else R.string.invite_everyoneAdded,
                    ),
                    fontFamily = Geist, fontSize = 15.sp, color = FuocoFixed.parchment,
                )
                if (friends.isEmpty()) {
                    Text(
                        stringResource(R.string.invite_noFriendsNote),
                        fontFamily = Geist, fontSize = 12.sp,
                        color = FuocoFixed.parchment.copy(alpha = 0.5f),
                    )
                }
            }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 20.dp, end = 20.dp, top = 14.dp, bottom = 40.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(filtered, key = { it.id }) { friend ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White.copy(alpha = 0.05f))
                            .clickableUnlessBusy { onPick(friend); onClose() }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .background(FuocoFixed.parchment.copy(alpha = 0.12f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                friend.initials,
                                fontFamily = InstrumentSerif, fontSize = 15.sp,
                                color = Theme.gold,
                            )
                        }
                        Text(
                            friend.fullName.orEmpty().ifEmpty {
                                stringResource(R.string.invite_aFriend)
                            },
                            fontFamily = Geist, fontSize = 16.sp,
                            color = FuocoFixed.parchment,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            Icons.Filled.AddCircle,
                            contentDescription = null,
                            tint = Theme.gold,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
        }
    }
}

/** Small uppercase status chip used across the party and roster lists. */
@Composable
internal fun StatusPill(text: String, color: Color, filled: Boolean) {
    Text(
        text.uppercase(),
        fontFamily = GeistMono, fontSize = 8.sp, letterSpacing = 1.sp,
        color = if (filled) FuocoFixed.night else color,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (filled) color else color.copy(alpha = 0.15f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}
