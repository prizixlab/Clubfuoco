package com.clubfuoco.app.features.fiamme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.FiammeData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fiamme — the loyalty balance, tier and activity log. Port of `FiammeView`.
 *
 * Redeeming is not wired up yet: it needs the reward catalogue and the
 * redeem→code flow, which land with the rest of the rewards surface.
 */
@Composable
fun FiammeScreen(api: ApiClient, onBack: () -> Unit) {
    var data by remember { mutableStateOf<FiammeData?>(null) }
    var loaded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        data = runCatching {
            withContext(Dispatchers.IO) { api.get("/api/fiamme", FiammeData.serializer()) }
        }.getOrNull()
        loaded = true
    }

    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        Column(
            Modifier
                .statusBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            BackChevronButton(onClick = onBack)
        }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp, end = 20.dp, bottom = 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                // The balance card borrows the ember ramp rather than the gold
                // membership one — fiamme are a flame, not a tier.
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(18.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(FuocoFixed.night, Theme.ember.copy(alpha = 0.55f)),
                            ),
                        )
                        .padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Kicker(
                        stringResource(R.string.fiamme_balanceSection),
                        color = FuocoFixed.parchment.copy(alpha = 0.6f),
                    )
                    Text(
                        "${data?.balance ?: 0}",
                        fontFamily = InstrumentSerif,
                        fontSize = 56.sp,
                        color = FuocoFixed.parchment,
                    )
                    data?.tier?.let {
                        Text(
                            it.uppercase(),
                            fontFamily = Geist,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp,
                            letterSpacing = 2.sp,
                            color = Theme.flame,
                        )
                    }
                }
            }

            item { Kicker(stringResource(R.string.fiamme_activitySection), color = Theme.fadedSand) }

            val activity = data?.activity.orEmpty()
            if (loaded && activity.isEmpty()) {
                item {
                    Text(
                        stringResource(R.string.fiamme_noActivity),
                        fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                        modifier = Modifier.padding(vertical = 16.dp),
                    )
                }
            }
            items(activity, key = { it.id }) { entry ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Theme.surface)
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        entry.reason ?: "—",
                        fontFamily = Geist, fontSize = 13.sp, color = Theme.ink,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        if (entry.amount >= 0) "+${entry.amount}" else "${entry.amount}",
                        fontFamily = Geist,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        color = if (entry.amount >= 0) Theme.success else Theme.wine,
                    )
                }
            }
        }
    }
}
