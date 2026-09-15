package com.clubfuoco.app.features.rumbalist

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.features.bookings.QrCode
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The dark booking sheet that opens from a venue's supplier offer. Port of
 * `RumbalistOfferSheet`.
 *
 * Free guestlist joins go through /api/rumbalist/join-guestlist and end on a
 * pass step with the door QR.
 *
 * VIP tables are NOT wired up yet: they need a PaymentIntent confirmed on
 * device, which on Android means Google Pay, which needs merchant setup that
 * does not exist. The card renders and explains itself rather than pretending
 * to work — see docs/TESTING.md B6.
 */
private val sheetInk = Color(0xFF141416)
private val sheetText = Color(0xFFF5F5F7)

@Composable
fun OfferSheet(
    offer: RumbalistOffer,
    clubId: String,
    venueName: String,
    venueAddress: String,
    planDate: String,
    api: ApiClient,
    onClose: () -> Unit,
) {
    val model: OfferSheetViewModel = viewModel()
    var plusOnes by remember { mutableStateOf(0) }

    val accent = offer.brand?.color?.let { parseHex(it) } ?: Theme.ember
    val confirmation = model.confirmation

    Column(
        Modifier
            .fillMaxSize()
            .background(sheetInk)
            .statusBarsPadding(),
    ) {
        Box(Modifier.fillMaxWidth().height(2.dp).background(accent))

        Text(
            offer.brand?.name?.uppercase() ?: "CLUB FUOCO",
            fontFamily = Geist,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            letterSpacing = 3.sp,
            color = if (offer.brand != null) accent else sheetText,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
        )

        if (confirmation != null) {
            PassStep(
                booking = confirmation,
                offer = offer,
                venueName = venueName,
                venueAddress = venueAddress,
                planDate = planDate,
                onDone = onClose,
            )
        } else {
            ReviewStep(
                offer = offer,
                venueName = venueName,
                venueAddress = venueAddress,
                planDate = planDate,
                plusOnes = plusOnes,
                onPlusOnes = { plusOnes = it },
                busy = model.busy,
                error = model.errorMessage,
                onConfirm = {
                    model.joinFree(clubId, venueName, planDate, plusOnes, api)
                },
                onClose = onClose,
            )
        }
    }
}

@Composable
private fun ReviewStep(
    offer: RumbalistOffer,
    venueName: String,
    venueAddress: String,
    planDate: String,
    plusOnes: Int,
    onPlusOnes: (Int) -> Unit,
    busy: Boolean,
    error: String?,
    onConfirm: () -> Unit,
    onClose: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp),
    ) {
        Text(
            stringResource(
                if (offer.isVip) R.string.rumbalist_titleVip else R.string.rumbalist_titleFree,
            ).uppercase(),
            fontFamily = GeistMono,
            fontSize = 10.sp,
            letterSpacing = 2.2.sp,
            color = sheetText.copy(alpha = 0.7f),
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = 18.dp),
        )

        Text(
            stringResource(R.string.rumbalist_joinGuestlistAt),
            fontFamily = Geist, fontSize = 13.sp, color = sheetText.copy(alpha = 0.55f),
        )
        Text(
            venueName,
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 30.sp, color = sheetText,
        )

        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 22.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color.White.copy(alpha = 0.05f))
                .padding(16.dp),
        ) {
            DetailRow(stringResource(R.string.rumbalist_venue), venueName)
            DetailRow(stringResource(R.string.rumbalist_address), venueAddress, small = true)
            DetailRow(stringResource(R.string.rumbalist_date), formatNight(planDate))
            SheetDivider()
            DetailRow(
                stringResource(
                    if (offer.isVip) R.string.rumbalist_titleVip else R.string.rumbalist_titleFree,
                ),
                offer.subtitle,
                small = true,
            )
            DetailRow(stringResource(R.string.rumbalist_valid), offer.validDays, small = true)
            DetailRow(stringResource(R.string.rumbalist_dressCode), offer.dressCode, small = true)
        }

        error?.let {
            Text(
                it,
                fontFamily = Geist, fontSize = 12.sp, color = Color(0xFFFFB4A2),
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
        }

        if (offer.isVip) {
            // Honest rather than broken: the VIP flow needs a confirmed
            // PaymentIntent, and Google Pay is not configured yet.
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 22.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, sheetText.copy(alpha = 0.18f), RoundedCornerShape(12.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    offer.priceEur?.let { "€${String.format("%.2f", it)}" } ?: "—",
                    fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                    fontSize = 28.sp, color = sheetText,
                )
                Text(
                    "Google Pay is not set up on this build yet, so VIP tables " +
                        "cannot be paid for here.",
                    fontFamily = Geist, fontSize = 12.sp, color = sheetText.copy(alpha = 0.6f),
                )
            }
        } else {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 22.dp)
                    .height(54.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFFF3EEE0).copy(alpha = if (busy) 0.55f else 1f))
                    .clickableUnlessBusy(enabled = !busy, onClick = onConfirm),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(R.string.rumbalist_freeGuestlist),
                    fontFamily = Geist, fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp, color = Color.Black,
                )
            }

            GuestStepper(plusOnes, onPlusOnes, Modifier.padding(top = 16.dp))
        }

        Text(
            stringResource(
                if (offer.isVip) R.string.rumbalist_vipFooter else R.string.rumbalist_freeFooter,
            ),
            fontFamily = Geist, fontSize = 11.sp, color = sheetText.copy(alpha = 0.45f),
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
        )

        Text(
            stringResource(R.string.common_cancel),
            fontFamily = Geist, fontSize = 14.sp, color = sheetText.copy(alpha = 0.6f),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clickableUnlessBusy(enabled = !busy, onClick = onClose)
                .padding(bottom = 24.dp),
        )
    }
}

@Composable
private fun PassStep(
    booking: RumbalistBookingResult,
    offer: RumbalistOffer,
    venueName: String,
    venueAddress: String,
    planDate: String,
    onDone: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        booking.doorToken?.let { token ->
            QrCode(
                token,
                Modifier
                    .size(232.dp)
                    .clip(RoundedCornerShape(16.dp)),
            )
        }
        Text(
            stringResource(R.string.rumbalist_atDoor),
            fontFamily = Geist, fontSize = 12.sp, color = sheetText.copy(alpha = 0.55f),
            modifier = Modifier.padding(top = 10.dp),
        )

        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 22.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color.White.copy(alpha = 0.05f))
                .padding(16.dp),
        ) {
            DetailRow(stringResource(R.string.rumbalist_venue), venueName)
            DetailRow(stringResource(R.string.rumbalist_address), venueAddress, small = true)
            SheetDivider()
            DetailRow(stringResource(R.string.rumbalist_date), formatNight(planDate))
            DetailRow(stringResource(R.string.rumbalist_dressCode), offer.dressCode, small = true)
            booking.qrCodeToken?.let {
                SheetDivider()
                DetailRow(stringResource(R.string.rumbalist_reference), it, small = true, mono = true)
            }
        }

        Text(
            stringResource(R.string.rumbalist_validNote),
            fontFamily = Geist, fontSize = 10.sp, color = sheetText.copy(alpha = 0.45f),
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
        )

        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 22.dp, bottom = 24.dp)
                .height(50.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0xFFF3EEE0))
                .clickableUnlessBusy(onClick = onDone),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                stringResource(R.string.common_done),
                fontFamily = Geist, fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp, color = Color.Black,
            )
        }
    }
}

@Composable
private fun GuestStepper(value: Int, onChange: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.05f))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(R.string.rumbalist_guestsNoApp),
                fontFamily = Geist, fontSize = 13.sp, color = sheetText,
            )
            Text(
                stringResource(R.string.rumbalist_guestsNoAppNote),
                fontFamily = Geist, fontSize = 11.sp, color = sheetText.copy(alpha = 0.5f),
            )
        }
        StepperButton("−") { if (value > 0) onChange(value - 1) }
        Text(
            "$value",
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
            color = sheetText,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        // Capped at the party size most doors will honour on a guestlist.
        StepperButton("+") { if (value < 5) onChange(value + 1) }
    }
}

@Composable
private fun StepperButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.10f))
            .clickableUnlessBusy(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontFamily = Geist, fontSize = 16.sp, color = sheetText)
    }
}

@Composable
private fun DetailRow(
    label: String,
    value: String,
    small: Boolean = false,
    mono: Boolean = false,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            fontFamily = Geist,
            fontSize = if (small) 11.sp else 12.sp,
            color = sheetText.copy(alpha = 0.45f),
        )
        Spacer(Modifier.weight(1f))
        Text(
            value,
            fontFamily = if (mono) GeistMono else Geist,
            fontSize = if (small) 11.sp else 13.sp,
            color = sheetText.copy(alpha = if (small) 0.7f else 1f),
            textAlign = TextAlign.End,
            modifier = Modifier.padding(start = 16.dp),
        )
    }
}

@Composable
private fun SheetDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))
}

private fun formatNight(ymd: String): String = runCatching {
    LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("EEEE d MMM", Locale.getDefault()))
}.getOrElse { ymd }

/** Supplier brand colours arrive as "#RRGGBB" strings from the portal. */
internal fun parseHex(value: String): Color? = runCatching {
    val hex = value.removePrefix("#")
    if (hex.length != 6) return null
    Color(hex.toLong(16) or 0xFF000000)
}.getOrNull()
