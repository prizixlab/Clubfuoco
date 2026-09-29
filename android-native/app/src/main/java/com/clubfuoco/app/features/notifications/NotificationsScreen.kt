package com.clubfuoco.app.features.notifications

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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.AppNotification
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * In-app notifications list. This is the DURABLE record — push is delivery on
 * top of it, so this screen must work even when push has never been granted.
 */
@Composable
fun NotificationsScreen(api: ApiClient, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<AppNotification>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        items = runCatching {
            withContext(Dispatchers.IO) {
                api.get("/api/notifications", ListSerializer(AppNotification.serializer()))
            }
        }.getOrElse { emptyList() }
        loaded = true

        // Opening the list is the read receipt.
        runCatching {
            withContext(Dispatchers.IO) {
                @Serializable
                data class MarkBody(val all: Boolean)
                @Serializable
                data class Ack(val ok: Boolean? = null)
                api.patch(
                    "/api/notifications",
                    Ack.serializer(),
                    Json.encodeToString(MarkBody.serializer(), MarkBody(true)),
                )
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        Column(
            Modifier
                .statusBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            BackChevronButton(onClick = onBack)
            Text(
                stringResource(R.string.notifications_title),
                fontFamily = InstrumentSerif,
                fontStyle = FontStyle.Italic,
                fontSize = 34.sp,
                color = Theme.ink,
            )
        }

        if (loaded && items.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.notifications_empty),
                    fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                )
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 20.dp, end = 20.dp, bottom = 24.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(items, key = { it.id }) { notification ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Theme.surface)
                            .padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        // Unread dot — the only state this row carries.
                        Box(
                            Modifier
                                .padding(top = 6.dp)
                                .size(7.dp)
                                .clip(CircleShape)
                                .background(
                                    if (notification.isRead) Theme.hairline else Theme.wine,
                                ),
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            notification.title?.let {
                                Text(
                                    it,
                                    fontFamily = Geist,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp,
                                    color = Theme.ink,
                                )
                            }
                            notification.body?.let {
                                Text(
                                    it,
                                    fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
