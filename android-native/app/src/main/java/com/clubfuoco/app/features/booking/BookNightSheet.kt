package com.clubfuoco.app.features.booking

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.PlaceDetail
import com.clubfuoco.app.stores.PlanStore
import java.util.Locale

/**
 * Booking a night at a venue — type, date, party size, what it costs, and the
 * two ways out.
 *
 * Port of `BookNightSheet`, with the payment step told plainly rather than
 * faked: Google Pay is not configured on this build, so the card path states
 * that instead of offering a button that always errors. The GROUP path is
 * unaffected and fully works, which is why it leads here.
 */
@Composable
fun BookNightSheet(
    detail: PlaceDetail,
    api: ApiClient,
    planDate: String,
    onOpenTickets: () -> Unit,
    onClose: () -> Unit,
) {
    val model: BookNightViewModel = viewModel(key = "book:${detail.placeId}")
    val context = LocalContext.current

    val tonight = stringResource(R.string.plan_tonight)
    val tomorrow = stringResource(R.string.plan_tomorrow)
    val groupFailed = stringResource(R.string.book_groupFailed)

    remember(model) { model.configure(detail, planDate); true }

    val days = remember(tonight, tomorrow) {
        PlanStore.dayOptions(Locale.getDefault(), tonight, tomorrow)
    }

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.book_cta),
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 26.sp, color = Theme.ink,
                modifier = Modifier.weight(1f),
            )
            Text(
                stringResource(R.string.common_cancel),
                fontFamily = Geist, fontSize = 14.sp, color = Theme.wine,
                modifier = Modifier.clickableUnlessBusy(onClick = onClose),
            )
        }

        // Once the group exists there is nothing left to configure, so the form
        // is replaced rather than left live underneath a success message.
        val code = model.groupCode
        if (code != null) {
            GroupCreated(code, onOpenTickets, onClose)
            return@Column
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            if (model.sellsVip) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Theme.surface)
                        .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    listOf(
                        "general" to R.string.bookings_general,
                        "vip" to R.string.bookings_vip,
                    ).forEach { (value, labelRes) ->
                        val on = model.bookingType == value
                        Box(
                            Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(9.dp))
                                .background(if (on) Theme.wine else Theme.surface)
                                .clickableUnlessBusy { model.bookingType = value }
                                .padding(vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                stringResource(labelRes),
                                fontFamily = Geist,
                                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                                fontSize = 13.sp,
                                color = if (on) Theme.cream else Theme.ink,
                            )
                        }
                    }
                }
            }

            // Date — today through +14, the same window the server enforces.
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Kicker(stringResource(R.string.plan_day), color = Theme.fadedSand, size = 9.sp)
                LazyColumn(
                    Modifier
                        .fillMaxWidth()
                        .height(132.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Theme.surface)
                        .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp)),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 4.dp),
                ) {
                    items(days, key = { it.value }) { option ->
                        val on = model.date == option.value
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickableUnlessBusy { model.date = option.value }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                option.label,
                                fontFamily = InstrumentSerif,
                                fontSize = 18.sp,
                                color = if (on) Theme.wine else Theme.ink,
                                modifier = Modifier.weight(1f),
                            )
                            if (on) {
                                Icon(
                                    Icons.Filled.Verified,
                                    contentDescription = null,
                                    tint = Theme.wine,
                                    modifier = Modifier.size(15.dp),
                                )
                            }
                        }
                    }
                }
            }

            // Party size.
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Theme.surface)
                    .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Kicker(
                    stringResource(R.string.book_partySize),
                    color = Theme.fadedSand,
                    size = 9.sp,
                    modifier = Modifier.weight(1f),
                )
                Stepper(Icons.Filled.Remove, model.partySize > 1) {
                    model.partySize -= 1
                }
                Text(
                    model.partySize.toString(),
                    fontFamily = InstrumentSerif, fontSize = 20.sp, color = Theme.ink,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
                Stepper(Icons.Filled.Add, model.partySize < 20) {
                    model.partySize += 1
                }
            }

            // What it costs. A free guestlist says so rather than printing
            // "€0.00" three times.
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Theme.surface)
                    .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (model.isFreeEntry) {
                    Text(
                        stringResource(R.string.rumbalist_free),
                        fontFamily = InstrumentSerif, fontSize = 22.sp, color = Theme.ink,
                    )
                    Text(
                        stringResource(R.string.book_freeEntryNote),
                        fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                    )
                } else {
                    SummaryRow(stringResource(R.string.book_subtotal), money(model.subtotal))
                    if (model.discount > 0) {
                        SummaryRow(
                            stringResource(R.string.book_discount),
                            "−${money(model.discount)}",
                            Theme.success,
                        )
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(R.string.book_total),
                            fontFamily = InstrumentSerif, fontSize = 20.sp, color = Theme.ink,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            money(model.total),
                            fontFamily = InstrumentSerif, fontSize = 24.sp, color = Theme.wine,
                        )
                    }
                }
            }

            model.errorMessage?.let {
                Text(it, fontFamily = Geist, fontSize = 12.sp, color = Theme.wine)
            }

            // The working path, and the primary one on Android for exactly that
            // reason: a group night needs no card at all for general entry.
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Theme.wine.copy(alpha = if (model.busy) 0.6f else 1f))
                    .clickableUnlessBusy(enabled = !model.busy) {
                        model.createGroup(api, groupFailed)
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp, Alignment.CenterHorizontally),
            ) {
                Icon(
                    Icons.Filled.Groups, contentDescription = null,
                    tint = Theme.cream, modifier = Modifier.size(17.dp),
                )
                Text(
                    stringResource(R.string.book_planWithFriends),
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                    color = Theme.cream,
                )
            }

            // Paying by card needs a confirmed PaymentIntent, which means
            // Google Pay, which is not set up on this build. Said plainly —
            // a pay button that always errors is worse than none.
            if (!model.isFreeEntry) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        stringResource(R.string.book_googlePayUnavailable),
                        fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 13.sp,
                        color = Theme.ink,
                    )
                    Text(
                        stringResource(R.string.book_googlePayNote),
                        fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun GroupCreated(code: String, onOpenTickets: () -> Unit, onClose: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .padding(top = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            Icons.Filled.Verified, contentDescription = null,
            tint = Theme.success, modifier = Modifier.size(44.dp),
        )
        Text(
            stringResource(R.string.book_groupCreated, code),
            fontFamily = InstrumentSerif, fontSize = 20.sp, color = Theme.ink,
            textAlign = TextAlign.Center,
        )
        Text(
            code,
            fontFamily = GeistMono, fontSize = 20.sp, letterSpacing = 3.sp,
            color = Theme.wine,
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp))
                .background(Theme.surface)
                .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                .padding(horizontal = 20.dp, vertical = 12.dp),
        )
        Text(
            stringResource(R.string.bookings_seeWhosGoing),
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
            color = Theme.wine,
            modifier = Modifier.padding(top = 8.dp).clickableUnlessBusy(onClick = onOpenTickets),
        )
        Text(
            stringResource(R.string.common_done),
            fontFamily = Geist, fontSize = 14.sp, color = Theme.stone,
            modifier = Modifier.clickableUnlessBusy(onClick = onClose),
        )
    }
}

@Composable
private fun SummaryRow(
    label: String,
    value: String,
    color: androidx.compose.ui.graphics.Color = Theme.stone,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = color,
        )
    }
}

@Composable
private fun Stepper(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(34.dp)
            .clip(CircleShape)
            .border(1.dp, Theme.hairline, CircleShape)
            .clickableUnlessBusy(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (enabled) Theme.ink else Theme.fadedSand,
            modifier = Modifier.size(15.dp),
        )
    }
}

private fun money(value: Double): String =
    if (value == value.toLong().toDouble()) "€${value.toLong()}"
    else String.format(Locale.US, "€%.2f", value)
