package com.clubfuoco.app.features.groups

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Share
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoImage
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.features.auth.FuocoTextField
import com.clubfuoco.app.features.bookings.QrCode
import com.clubfuoco.app.models.GroupMember
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * One group night: who's coming, your RSVP, your pass, and the chat. Port of
 * `GroupDetailView`.
 */
@Composable
fun GroupDetailScreen(
    groupId: String,
    api: ApiClient,
    onBack: () -> Unit,
) {
    val model: GroupDetailViewModel = viewModel()
    val context = LocalContext.current
    var draft by remember { mutableStateOf("") }

    LaunchedEffect(groupId) { model.load(groupId, api) }

    val detail = model.detail

    Column(Modifier.fillMaxSize().background(Theme.cream)) {
        Box(Modifier.fillMaxWidth().height(180.dp)) {
            FuocoImage(detail?.clubImage, Modifier.fillMaxSize())
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.35f),
                        1f to Color.Black.copy(alpha = 0.7f),
                    ),
                ),
            )
            com.clubfuoco.app.core.designsystem.BackChevronButton(
                Modifier.statusBarsPadding().padding(start = 16.dp, top = 8.dp),
                onClick = onBack,
            )
            Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
                Text(
                    detail?.clubName ?: "—",
                    fontFamily = InstrumentSerif,
                    fontStyle = FontStyle.Italic,
                    fontSize = 28.sp,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    detail?.bookingDate?.let { formatNight(it) }.orEmpty(),
                    fontFamily = Geist, fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
        }

        if (detail == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.common_loading),
                    fontFamily = Geist, fontSize = 13.sp, color = Theme.fadedSand,
                )
            }
            return@Column
        }

        LazyColumn(
            Modifier.weight(1f),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp, end = 20.dp, top = 16.dp, bottom = 16.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val me = detail.me

            // RSVP — only when the invite is still unanswered.
            if (me?.rsvp == "invited") {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Kicker(stringResource(R.string.groups_yourSpot), color = Theme.wine)
                        if (me.paymentRequired && (me.amountDue ?: 0.0) > 0) {
                            // Paid joins need a confirmed PaymentIntent, which
                            // means Google Pay — not configured yet, so say so
                            // rather than offering a button that cannot work.
                            Column(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                                    .padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(
                                    stringResource(R.string.groups_paymentNeeded),
                                    fontFamily = Geist, fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp, color = Theme.ink,
                                )
                                Text(
                                    "€${String.format("%.2f", me.amountDue ?: 0.0)} · " +
                                        "Google Pay is not set up on this build yet.",
                                    fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                                )
                            }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                RsvpButton(
                                    stringResource(R.string.groups_going),
                                    filled = true,
                                    modifier = Modifier.weight(1f),
                                    enabled = !model.busy,
                                ) { model.respond(groupId, "going", api) }
                                RsvpButton(
                                    stringResource(R.string.groups_maybe),
                                    filled = false,
                                    modifier = Modifier.weight(1f),
                                    enabled = !model.busy,
                                ) { model.respond(groupId, "maybe", api) }
                                RsvpButton(
                                    stringResource(R.string.groups_declined),
                                    filled = false,
                                    modifier = Modifier.weight(1f),
                                    enabled = !model.busy,
                                ) { model.respond(groupId, "declined", api) }
                            }
                        }
                        model.errorMessage?.let {
                            Text(it, fontFamily = Geist, fontSize = 12.sp, color = Theme.wine)
                        }
                    }
                }
            }

            // Your pass, once you're going.
            me?.qrToken?.let { token ->
                item {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Theme.surface)
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Kicker(stringResource(R.string.groups_yourPass), color = Theme.fadedSand)
                        QrCode(token, Modifier.size(180.dp).clip(RoundedCornerShape(12.dp)))
                    }
                }
            }

            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Kicker(
                        stringResource(
                            R.string.groups_going,
                        ),
                        color = Theme.fadedSand,
                    )
                    Spacer(Modifier.weight(1f))
                    Row(
                        Modifier.clickableUnlessBusy {
                            shareInvite(context, detail.clubName, detail.inviteCode)
                        },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            Icons.Filled.Share, null,
                            tint = Theme.wine, modifier = Modifier.size(14.dp),
                        )
                        Text(
                            stringResource(R.string.groups_share),
                            fontFamily = Geist, fontWeight = FontWeight.Medium,
                            fontSize = 12.sp, color = Theme.wine,
                        )
                    }
                }
            }

            items(detail.members, key = { it.id }) { member -> MemberRow(member) }

            if (model.messages.isNotEmpty()) {
                item { Kicker("CHAT", color = Theme.fadedSand) }
                items(model.messages, key = { it.id }) { message ->
                    MessageBubble(message)
                }
            }
        }

        // Chat composer.
        Row(
            Modifier
                .fillMaxWidth()
                .background(Theme.cream)
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier
                    .weight(1f)
                    .height(46.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Theme.surface)
                    .border(1.dp, Theme.hairline, RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FuocoTextField(draft, { draft = it }, Modifier.weight(1f))
            }
            Box(
                Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(Theme.ink)
                    .clickableUnlessBusy {
                        model.send(groupId, draft, api)
                        draft = ""
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send, null,
                    tint = Theme.cream, modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

@Composable
private fun RsvpButton(
    label: String,
    filled: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (filled) Theme.wine else Theme.surface)
            .then(
                if (filled) Modifier
                else Modifier.border(1.dp, Theme.hairline, RoundedCornerShape(12.dp)),
            )
            .clickableUnlessBusy(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontFamily = Geist,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            color = if (filled) Theme.cream else Theme.ink,
        )
    }
}

@Composable
private fun MemberRow(member: GroupMember) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Theme.surface)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(38.dp).clip(CircleShape).background(Theme.wine.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            if (member.avatarUrl != null) {
                FuocoImage(
                    member.avatarUrl,
                    Modifier.size(38.dp).clip(CircleShape),
                    targetWidth = 38.dp,
                )
            } else {
                Text(
                    member.initials,
                    fontFamily = InstrumentSerif, fontSize = 15.sp, color = Theme.wine,
                )
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                member.fullName ?: "—",
                fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                color = Theme.ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (member.role == "organizer") {
                Text(
                    stringResource(R.string.groups_organizer),
                    fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
                )
            }
        }
        Text(
            stringResource(
                when (member.rsvp) {
                    "going" -> R.string.groups_going
                    "maybe" -> R.string.groups_maybe
                    "declined" -> R.string.groups_declined
                    else -> R.string.groups_invited
                },
            ),
            fontFamily = Geist,
            fontWeight = FontWeight.SemiBold,
            fontSize = 10.sp,
            color = if (member.rsvp == "going") Theme.success else Theme.fadedSand,
        )
    }
}

@Composable
private fun MessageBubble(message: com.clubfuoco.app.models.GroupMessage) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (message.isMine) Alignment.End else Alignment.Start,
    ) {
        if (!message.isMine) {
            Text(
                message.shortName,
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.sp,
                color = Theme.fadedSand,
                modifier = Modifier.padding(start = 6.dp, bottom = 2.dp),
            )
        }
        Text(
            message.body,
            fontFamily = Geist,
            fontSize = 13.sp,
            color = if (message.isMine) Theme.cream else Theme.ink,
            modifier = Modifier
                .clip(RoundedCornerShape(14.dp))
                .background(if (message.isMine) Theme.ink else Theme.surface)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

/** Share the join link via the system sheet. */
private fun shareInvite(context: android.content.Context, clubName: String, code: String) {
    val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(
            android.content.Intent.EXTRA_TEXT,
            "https://clubfuoco.com/join/$code",
        )
    }
    context.startActivity(android.content.Intent.createChooser(intent, clubName))
}

private fun formatNight(ymd: String): String = runCatching {
    LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("EEEE d MMM", Locale.getDefault()))
}.getOrElse { ymd }
