package com.clubfuoco.app.features.inviteclaim

import android.content.Context
import android.content.Intent
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.features.bookings.QrCode
import com.clubfuoco.app.features.auth.OAuthButtons
import com.clubfuoco.app.models.InviteDetail
import com.clubfuoco.app.models.InviteSlot
import com.clubfuoco.app.stores.AuthStore
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The promoter-invite screen — the App Store funnel, and for many people the
 * very first thing they see of Club Fuoco.
 *
 * Two states, not two screens: the claim FORM until a spot is theirs, then the
 * TICKET. Re-opening a claimed invite goes straight to the ticket.
 *
 * Always dark. It is a door pass, and it is shown at a door.
 *
 * Port of `InviteClaimView`. That view has NO localization at all — 47 English
 * literals and not one lookup — so every string here is new, and the keys should
 * be back-ported into the iOS catalog.
 */
@Composable
fun InviteClaimScreen(
    token: String,
    auth: AuthStore,
    api: ApiClient,
    preclaimedGuestId: String? = null,
    preclaimedName: String? = null,
    onClose: () -> Unit,
) {
    val model: InviteClaimViewModel = viewModel(key = "invite:$token")
    val context = LocalContext.current

    remember(model) {
        model.configure(
            token = token,
            api = api,
            profileName = auth.profile?.fullName,
            preclaimedGuestId = preclaimedGuestId,
            preclaimedName = preclaimedName,
        )
        true
    }

    /** Which slot the picker is filling: a form slot key, or TICKET_SLOT. */
    var pickingSlot by remember { mutableStateOf<String?>(null) }

    BackHandler(onBack = onClose)

    Box(Modifier.fillMaxSize().background(FuocoFixed.night)) {
        val detail = model.detail
        val guestId = model.claimedGuestId

        when {
            model.loading -> Unit

            model.error == InviteError.LOAD || detail == null -> LoadFailed(onClose)

            guestId != null -> TicketView(
                model = model,
                detail = detail,
                guestId = guestId,
                auth = auth,
                api = api,
                onPickFriend = { pickingSlot = TICKET_SLOT },
                onClose = onClose,
            )

            else -> ClaimForm(
                model = model,
                detail = detail,
                onPickFriend = { pickingSlot = it },
                onClose = onClose,
            )
        }

        val slot = pickingSlot
        if (slot != null) {
            FriendPickerSheet(
                api = api,
                excluded = if (slot == TICKET_SLOT) {
                    model.excludedForInvite
                } else {
                    model.assignedFriendIds
                },
                onPick = { friend ->
                    if (slot == TICKET_SLOT) {
                        guestId?.let { model.assignFriendFromTicket(context, friend, it) }
                    } else {
                        model.assignToSlot(slot, friend)
                    }
                },
                onClose = { pickingSlot = null },
            )
        }
    }
}

private const val TICKET_SLOT = "__ticket__"

@Composable
private fun LoadFailed(onClose: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(40.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.invite_loadFailed),
            fontFamily = Geist, fontSize = 15.sp, color = FuocoFixed.parchment,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.common_close),
            fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
            color = Theme.gold,
            modifier = Modifier.clickableUnlessBusy(onClick = onClose),
        )
    }
}

// ── The form ─────────────────────────────────────────────────────────────────

@Composable
private fun ClaimForm(
    model: InviteClaimViewModel,
    detail: InviteDetail,
    onPickFriend: (String) -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val night = detail.night
    val cap = night.maxPlusOnes ?: 20

    // Checkout opens in the browser. Consumed once so returning to the app does
    // not bounce straight back out to Stripe.
    LaunchedEffect(model.checkoutUrl) {
        model.checkoutUrl?.let {
            uriHandler.openUri(it)
            model.checkoutUrl = null
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                stringResource(R.string.invite_youreInvited).uppercase(),
                fontFamily = GeistMono, fontSize = 11.sp, letterSpacing = 2.sp,
                color = Theme.gold,
            )
            Text(
                night.title ?: night.venueName,
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 40.sp, color = FuocoFixed.parchment,
            )
            Text(
                "${night.venueName} · ${formatNight(night.nightDate)}",
                fontFamily = Geist, fontSize = 13.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.7f),
            )
        }

        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(CARD)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                stringResource(R.string.invite_reserveYourSpot).uppercase(),
                fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 2.sp,
                color = Theme.gold,
            )

            NameField(model.name) { model.name = it }

            Box(
                Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(FuocoFixed.parchment.copy(alpha = 0.1f)),
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.invite_bringPeople).uppercase(),
                    fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.5.sp,
                    color = FuocoFixed.parchment.copy(alpha = 0.5f),
                    modifier = Modifier.weight(1f),
                )
                if (model.slots.isNotEmpty()) {
                    Text(
                        "${model.slots.size}/$cap",
                        fontFamily = GeistMono, fontSize = 9.sp,
                        color = FuocoFixed.parchment.copy(alpha = 0.4f),
                    )
                }
            }

            model.slots.forEach { slot ->
                SlotRow(
                    slot = slot,
                    onInvite = { onPickFriend(slot.key) },
                    onRemove = { model.removeSlot(slot.key) },
                )
            }

            if (model.slots.size < cap) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickableUnlessBusy { model.addOpenSlot() }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        Icons.Filled.AddCircle, contentDescription = null,
                        tint = Theme.gold, modifier = Modifier.size(16.dp),
                    )
                    Text(
                        stringResource(R.string.invite_addSpot),
                        fontFamily = Geist, fontWeight = FontWeight.Medium,
                        fontSize = 14.sp, color = Theme.gold,
                    )
                }
            }

            if (model.openSpots > 0) {
                ShareRow(
                    label = stringResource(R.string.invite_shareOpenSpots),
                    tint = FuocoFixed.parchment.copy(alpha = 0.8f),
                ) {
                    shareInvite(context, night.title ?: night.venueName, model.inviteUrl)
                }
            }
        }

        // The price is ON the button, never buried in the body: nobody should
        // tap "join" and discover a card form.
        val heads = 1 + model.openSpots
        val label = when {
            model.submitting && night.isPaid -> stringResource(R.string.invite_openingCheckout)
            model.submitting -> stringResource(R.string.invite_joining)
            !night.isPaid -> stringResource(R.string.invite_addMeToTheList)
            heads > 1 ->
                stringResource(R.string.invite_joinForHeads, night.priceLabel(heads), heads)
            else -> stringResource(R.string.invite_joinFor, night.priceLabel())
        }
        val ready = !model.submitting && model.name.trim().isNotEmpty()

        Box(
            Modifier
                .fillMaxWidth()
                .clip(CircleShape)
                .background(Theme.gold.copy(alpha = if (ready) 1f else 0.4f))
                .clickableUnlessBusy(enabled = ready) {
                    if (night.isPaid) model.startCheckout()
                    else model.submit(context) {}
                }
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label,
                fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                color = FuocoFixed.night,
            )
        }

        // Pay later. Only on a paid night — a free list has nothing to defer,
        // and the button would just be a second, worse way to say yes.
        if (night.isPaid) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(CircleShape)
                    .border(
                        1.dp,
                        if (model.saved) Theme.gold.copy(alpha = 0.5f)
                        else FuocoFixed.parchment.copy(alpha = 0.22f),
                        CircleShape,
                    )
                    .clickableUnlessBusy(enabled = !model.savingEvent) { model.toggleSave() }
                    .padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (model.saved) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                    contentDescription = null,
                    tint = if (model.saved) Theme.gold else FuocoFixed.parchment.copy(alpha = 0.85f),
                    modifier = Modifier.size(15.dp),
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    stringResource(
                        if (model.saved) R.string.invite_savedPayAnyTime
                        else R.string.invite_saveItPayLater,
                    ),
                    fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                    color = if (model.saved) Theme.gold
                    else FuocoFixed.parchment.copy(alpha = 0.85f),
                )
            }

            Text(
                stringResource(R.string.invite_saveHoldsNothing).uppercase(),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.2.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.45f),
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        model.error?.let { kind ->
            if (kind != InviteError.LOAD) {
                Text(
                    stringResource(
                        when (kind) {
                            InviteError.CLAIM -> R.string.invite_claimFailed
                            InviteError.CHECKOUT -> R.string.invite_checkoutFailed
                            InviteError.NEEDS_ACCOUNT -> R.string.invite_signInToSave
                            else -> R.string.invite_claimFailed
                        },
                    ),
                    fontFamily = Geist, fontSize = 12.sp, color = Theme.gold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (detail.groupVisible) {
            Text(
                stringResource(R.string.invite_everyoneWillSeeYou).uppercase(),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.5.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.5f),
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Text(
            stringResource(R.string.invite_notNow),
            fontFamily = Geist, fontSize = 14.sp,
            color = FuocoFixed.parchment.copy(alpha = 0.5f),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp)
                .clickableUnlessBusy(onClick = onClose),
        )
    }
}

@Composable
private fun NameField(value: String, onChange: (String) -> Unit) {
    Box(Modifier.fillMaxWidth()) {
        Column {
            Box(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                if (value.isEmpty()) {
                    Text(
                        stringResource(R.string.invite_fullName),
                        fontFamily = Geist, fontSize = 16.sp,
                        color = FuocoFixed.parchment.copy(alpha = 0.5f),
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onChange,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Words,
                    ),
                    textStyle = TextStyle(
                        fontFamily = Geist, fontSize = 16.sp, color = FuocoFixed.parchment,
                    ),
                    cursorBrush = SolidColor(Theme.gold),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(FuocoFixed.parchment.copy(alpha = 0.2f)),
            )
        }
    }
}

@Composable
private fun SlotRow(slot: InviteSlot, onInvite: () -> Unit, onRemove: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (slot) {
            is InviteSlot.Open -> {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .border(1.dp, FuocoFixed.parchment.copy(alpha = 0.15f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.PersonAdd, contentDescription = null,
                        tint = FuocoFixed.parchment.copy(alpha = 0.5f),
                        modifier = Modifier.size(15.dp),
                    )
                }
                Text(
                    stringResource(R.string.invite_inviteAFriend),
                    fontFamily = Geist, fontSize = 15.sp, color = Theme.gold,
                    modifier = Modifier.weight(1f).clickableUnlessBusy(onClick = onInvite),
                )
                StatusPill(
                    stringResource(R.string.invite_open),
                    FuocoFixed.parchment.copy(alpha = 0.35f),
                    filled = false,
                )
            }

            is InviteSlot.Friend -> {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(FuocoFixed.parchment.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        slot.friend.initials,
                        fontFamily = InstrumentSerif, fontSize = 15.sp, color = Theme.gold,
                    )
                }
                Text(
                    slot.friend.fullName.orEmpty().ifEmpty {
                        stringResource(R.string.invite_aFriend)
                    },
                    fontFamily = Geist, fontSize = 15.sp, color = FuocoFixed.parchment,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        RemoveSlotButton { onRemove() }
    }
}

@Composable
private fun RemoveSlotButton(enabled: Boolean = true, onRemove: () -> Unit) {
    Icon(
        Icons.Filled.Close,
        contentDescription = null,
        tint = FuocoFixed.parchment.copy(alpha = 0.4f),
        modifier = Modifier
            .size(26.dp)
            .clip(CircleShape)
            .clickableUnlessBusy(enabled = enabled, onClick = onRemove)
            .padding(7.dp),
    )
}

// ── The ticket ───────────────────────────────────────────────────────────────

@Composable
private fun TicketView(
    model: InviteClaimViewModel,
    detail: InviteDetail,
    guestId: String,
    auth: AuthStore,
    api: ApiClient,
    onPickFriend: () -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val night = detail.night

    DisposableEffect(guestId) {
        model.startTicket(context, guestId)
        onDispose { model.stopTicket() }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 28.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text(
            stringResource(R.string.invite_youreOnTheList).uppercase(),
            fontFamily = GeistMono, fontSize = 11.sp, letterSpacing = 2.sp,
            color = Theme.gold,
        )
        Text(
            model.name,
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 34.sp, color = FuocoFixed.parchment,
            textAlign = TextAlign.Center,
        )
        Text(
            "${night.title ?: night.venueName} · ${formatNight(night.nightDate)}",
            fontFamily = Geist, fontSize = 13.sp,
            color = FuocoFixed.parchment.copy(alpha = 0.7f),
            textAlign = TextAlign.Center,
        )

        QrCode(
            token = "fuoco-invite:$guestId",
            modifier = Modifier
                .size(244.dp)
                .clip(RoundedCornerShape(16.dp)),
        )

        Text(
            stringResource(R.string.invite_showAtDoor).uppercase(),
            fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 1.5.sp,
            color = FuocoFixed.parchment.copy(alpha = 0.5f),
        )

        // The reduced signup. It sits HERE, after the spot is already theirs,
        // rather than in front of the claim: a wizard between a guest and an
        // RSVP loses the guest, and the claim endpoint accepts anonymous callers
        // anyway.
        //
        // What it buys is KEEPING. An anonymous claim leaves claimed_by_user
        // null, so the spot exists only in this screen's state — relaunch and
        // the ticket is gone and it never reaches the Tickets tab.
        if (!auth.hasAccount) KeepSpotCard(model, auth, guestId)

        PartyCard(model, guestId, night.title ?: night.venueName, onPickFriend)

        if (model.guests.isNotEmpty()) RosterCard(model)

        Text(
            stringResource(R.string.common_done),
            fontFamily = Geist, fontSize = 14.sp,
            color = FuocoFixed.parchment.copy(alpha = 0.6f),
            modifier = Modifier.padding(top = 10.dp).clickableUnlessBusy(onClick = onClose),
        )
    }
}

/**
 * "Keep this spot" — one tap, no form.
 *
 * The name is already captured (they typed it to claim) and Google supplies a
 * verified identity without a keyboard, so this asks for nothing else. Birthday,
 * gender and the survey all wait: the app blocks on a complete profile at the
 * next launch, which is the right moment for them and the wrong one for this.
 */
@Composable
private fun KeepSpotCard(model: InviteClaimViewModel, auth: AuthStore, guestId: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(FuocoFixed.parchment.copy(alpha = 0.06f))
            .border(1.dp, FuocoFixed.parchment.copy(alpha = 0.12f), RoundedCornerShape(18.dp))
            .padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (model.attached) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Filled.Verified, contentDescription = null,
                    tint = Theme.gold, modifier = Modifier.size(18.dp),
                )
                Text(
                    stringResource(R.string.invite_savedToAccount),
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    color = FuocoFixed.parchment,
                )
            }
            return@Column
        }

        Text(
            stringResource(R.string.invite_keepThisSpot),
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 22.sp, color = FuocoFixed.parchment,
        )
        Text(
            stringResource(R.string.invite_keepThisSpotNote),
            fontFamily = Geist, fontSize = 12.sp,
            color = FuocoFixed.parchment.copy(alpha = 0.65f),
            textAlign = TextAlign.Center,
        )

        if (!model.attaching) {
            // Deliberately ignoring `onNeedsProfile`: the profile wizard is
            // exactly what this lane exists to defer.
            OAuthButtons(auth = auth, onNeedsProfile = {})
        }

        LaunchedEffect(auth.hasAccount) {
            if (auth.hasAccount && !model.attached && !model.attaching) {
                model.attachSpot(guestId)
            }
        }

        if (model.attachFailed) {
            Text(
                stringResource(R.string.invite_attachFailed),
                fontFamily = Geist, fontSize = 12.sp, color = Theme.gold,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun PartyCard(
    model: InviteClaimViewModel,
    guestId: String,
    shareTitle: String,
    onPickFriend: () -> Unit,
) {
    val context = LocalContext.current

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(CARD)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.invite_myGuests).uppercase(),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.5.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.5f),
                modifier = Modifier.weight(1f),
            )
            if (!model.partyBusy && model.slotLimit > 0) {
                // The whole party against the promoter's allowance: me + slots.
                Text(
                    "${1 + model.usedSlots}/${1 + model.slotLimit}",
                    fontFamily = GeistMono, fontSize = 9.sp,
                    color = FuocoFixed.parchment.copy(alpha = 0.4f),
                )
            }
        }

        val checkedIn = model.myGuest(guestId)?.checkedInAt != null
        PartyRow(
            name = stringResource(R.string.invite_youRow, model.name),
            pill = {
                StatusPill(
                    stringResource(
                        if (checkedIn) R.string.invite_checkedIn else R.string.invite_going,
                    ),
                    Theme.gold,
                    filled = checkedIn,
                )
            },
        )

        // Friend slots — invited until they show up in the roster under their
        // own name, at which point they are going and can no longer be removed.
        model.invitedList.forEach { friend ->
            val going = model.claimedUserIds.contains(friend.id.lowercase())
            PartyRow(
                name = friend.name.ifEmpty { stringResource(R.string.invite_aFriend) },
                pill = {
                    StatusPill(
                        stringResource(
                            if (going) R.string.invite_going else R.string.invite_invited,
                        ),
                        if (going) Theme.gold else FuocoFixed.parchment.copy(alpha = 0.4f),
                        filled = false,
                    )
                },
                trailing = if (going) null else {
                    { RemoveSlotButton(!model.partyBusy) { model.removeInvited(context, friend.id) } }
                },
            )
        }

        // Open slots — each can take a specific friend or be left for the shared
        // link. Same slot, two ways to fill it.
        repeat(model.partyPlusOnes) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    stringResource(R.string.invite_openSpot),
                    fontFamily = Geist, fontSize = 14.sp,
                    color = FuocoFixed.parchment.copy(alpha = 0.85f),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    stringResource(R.string.invite_invite),
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
                    color = Theme.gold,
                    modifier = Modifier.clickableUnlessBusy(enabled = !model.partyBusy) {
                        onPickFriend()
                    },
                )
                StatusPill(
                    stringResource(R.string.invite_open),
                    FuocoFixed.parchment.copy(alpha = 0.35f),
                    filled = false,
                )
                RemoveSlotButton(!model.partyBusy) {
                    model.changePlusOnes(model.partyPlusOnes - 1, guestId)
                }
            }
        }

        if (model.canAddSlot) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickableUnlessBusy(enabled = !model.partyBusy) {
                        model.changePlusOnes(model.partyPlusOnes + 1, guestId)
                    }
                    .padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Filled.AddCircle, contentDescription = null,
                    tint = FuocoFixed.parchment.copy(alpha = 0.8f),
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    stringResource(R.string.invite_addSpot),
                    fontFamily = Geist, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                    color = FuocoFixed.parchment.copy(alpha = 0.8f),
                )
            }
        } else if (model.slotLimit > 0 && model.usedSlots >= model.slotLimit) {
            Text(
                stringResource(R.string.invite_allSpotsFilled),
                fontFamily = Geist, fontSize = 11.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.4f),
            )
        }

        // Anyone who opens this link takes one of the open spots.
        if (model.partyPlusOnes > 0) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(FuocoFixed.parchment.copy(alpha = 0.1f)),
            )
            ShareRow(
                label = stringResource(R.string.invite_shareOpenSpots),
                tint = FuocoFixed.parchment,
            ) {
                shareInvite(context, shareTitle, model.inviteUrl)
            }
        }
    }
}

@Composable
private fun RosterCard(model: InviteClaimViewModel) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(CARD)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.invite_whosGoing).uppercase(),
                fontFamily = GeistMono, fontSize = 9.sp, letterSpacing = 1.5.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.5f),
                modifier = Modifier.weight(1f),
            )
            // Heads, not rows: a guest bringing three people is four at the door.
            Text(
                model.guests.sumOf { 1 + it.plusOnes }.toString(),
                fontFamily = GeistMono, fontSize = 9.sp,
                color = FuocoFixed.parchment.copy(alpha = 0.4f),
            )
        }
        model.guests.forEach { guest ->
            PartyRow(
                name = if (guest.plusOnes > 0) "${guest.fullName} +${guest.plusOnes}"
                else guest.fullName,
                pill = if (guest.checkedInAt == null) null else {
                    {
                        StatusPill(
                            stringResource(R.string.invite_checkedIn),
                            Theme.gold,
                            filled = true,
                        )
                    }
                },
            )
        }
    }
}

@Composable
private fun PartyRow(
    name: String,
    pill: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            name,
            fontFamily = Geist, fontSize = 14.sp, color = FuocoFixed.parchment,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        pill?.invoke()
        trailing?.invoke()
    }
}

@Composable
private fun ShareRow(label: String, tint: Color, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickableUnlessBusy(onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Filled.Share, contentDescription = null,
            tint = tint, modifier = Modifier.size(14.dp),
        )
        Text(
            label,
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
            color = tint,
        )
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The card surface on this screen — darker than the page, not lighter. */
private val CARD = Color(0xFF15110E)

private fun shareInvite(context: Context, title: String, url: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, url)
        putExtra(Intent.EXTRA_SUBJECT, title)
    }
    context.startActivity(Intent.createChooser(intent, title))
}

private fun formatNight(ymd: String): String = runCatching {
    LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault()))
}.getOrElse { ymd }
