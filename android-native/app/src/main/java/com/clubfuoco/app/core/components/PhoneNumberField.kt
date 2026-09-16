package com.clubfuoco.app.core.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy

/**
 * Phone input with a country-code selector.
 *
 * Binds to ONE string stored as "<dialCode> <national number>", e.g.
 * "+34 612 345 678". The dial code is always part of the saved value — a bare
 * national number is ambiguous the moment anyone outside Spain uses the app, and
 * the door cannot ring a number it cannot dial.
 *
 * Port of `PhoneNumberField`.
 */
@Composable
fun PhoneNumberField(
    phone: String,
    onPhoneChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Split out of the bound value, and re-split whenever it changes underneath
    // us — Settings fills the binding from an async profile fetch, so a one-shot
    // parse at first composition sees an empty string and the saved number never
    // appears. On iOS that looked exactly like "phone numbers don't save".
    val split = remember(phone) { splitPhone(phone) }
    var dialCode by remember { mutableStateOf(split.first) }
    var national by remember { mutableStateOf(split.second) }
    var showPicker by remember { mutableStateOf(false) }

    // Adopt an external write only when it is not the echo of our own last
    // recombine, or typing would fight the binding on every keystroke.
    val combined = if (national.isEmpty()) "" else "$dialCode $national"
    if (phone != combined) {
        dialCode = split.first
        national = split.second
    }

    val maxDigits = remember(dialCode) {
        COUNTRIES.firstOrNull { it.dialCode == dialCode }?.digits ?: 15
    }

    fun push(code: String, number: String) {
        onPhoneChange(if (number.isEmpty()) "" else "$code $number")
    }

    if (showPicker) {
        CountryPickerSheet(
            onPick = { country ->
                dialCode = country.dialCode
                // Re-cap for the new country: a 10-digit US number pasted then
                // switched to Norway (8) has to lose the tail, not be stored
                // as an impossible number.
                national = national.take(country.digits)
                push(country.dialCode, national)
                showPicker = false
            },
            onClose = { showPicker = false },
        )
        return
    }

    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            Modifier.clickableUnlessBusy { showPicker = true },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                COUNTRIES.firstOrNull { it.dialCode == dialCode }?.flag ?: "🏳️",
                fontSize = 18.sp,
            )
            Text(dialCode, fontFamily = Geist, fontSize = 16.sp, color = Theme.ink)
            Icon(
                Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = Theme.fadedSand,
                modifier = Modifier.size(14.dp),
            )
        }

        Box(Modifier.weight(1f)) {
            if (national.isEmpty()) {
                Text(
                    placeholderFor(maxDigits),
                    fontFamily = Geist, fontSize = 16.sp, color = Theme.fadedSand,
                )
            }
            BasicTextField(
                value = national,
                onValueChange = { input ->
                    // Digits only, capped to this country's length.
                    national = input.filter { it.isDigit() }.take(maxDigits)
                    push(dialCode, national)
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                textStyle = TextStyle(fontFamily = Geist, fontSize = 16.sp, color = Theme.ink),
                cursorBrush = SolidColor(Theme.wine),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Searchable country list. Filters on name and on dial code. */
@Composable
private fun CountryPickerSheet(onPick: (Country) -> Unit, onClose: () -> Unit) {
    var query by remember { mutableStateOf("") }

    val filtered = remember(query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) {
            COUNTRIES
        } else {
            val digits = q.filter { it.isDigit() }
            COUNTRIES.filter {
                it.name.lowercase().contains(q) ||
                    it.dialCode.contains(q) ||
                    (digits.isNotEmpty() && it.dialCode.contains(digits))
            }
        }
    }

    BackHandler(onBack = onClose)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .statusBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.phone_country),
                fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
                fontSize = 24.sp, color = Theme.ink,
                modifier = Modifier.weight(1f),
            )
            Text(
                stringResource(R.string.common_close),
                fontFamily = Geist, fontSize = 14.sp, color = Theme.wine,
                modifier = Modifier.clickableUnlessBusy(onClick = onClose),
            )
        }

        Box(
            Modifier
                .padding(horizontal = 20.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Theme.surface)
                .border(1.dp, Theme.hairline, RoundedCornerShape(12.dp))
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            if (query.isEmpty()) {
                Text(
                    stringResource(R.string.phone_searchCountry),
                    fontFamily = Geist, fontSize = 14.sp, color = Theme.fadedSand,
                )
            }
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = TextStyle(fontFamily = Geist, fontSize = 14.sp, color = Theme.ink),
                cursorBrush = SolidColor(Theme.wine),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 20.dp, end = 20.dp, top = 12.dp, bottom = 40.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(filtered, key = { it.key }) { country ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickableUnlessBusy { onPick(country) }
                        .padding(horizontal = 12.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(country.flag, fontSize = 22.sp)
                    Text(
                        country.name,
                        fontFamily = Geist, fontSize = 16.sp, color = Theme.ink,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        country.dialCode,
                        fontFamily = Geist, fontSize = 15.sp, color = Theme.stone,
                    )
                }
            }
        }
    }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Split a stored value into a known dial code and the rest.
 *
 * A value with no "+" is treated as a bare national number against the default
 * code rather than discarded — legacy rows predate the picker, and losing
 * someone's number to a format change would be worse than assuming Spain.
 */
internal fun splitPhone(raw: String, default: String = DEFAULT_DIAL): Pair<String, String> {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return default to ""
    if (!trimmed.startsWith("+")) return default to trimmed.filter { it.isDigit() }

    val compact = trimmed.replace(" ", "")
    val match = COUNTRIES_BY_DIAL_LENGTH.firstOrNull { compact.startsWith(it.dialCode) }
        ?: return default to compact.filter { it.isDigit() }

    return match.dialCode to compact.drop(match.dialCode.length).filter { it.isDigit() }
}

/**
 * A greyed example, grouped in threes. A trailing single digit is merged into
 * the previous group so it never reads as its own stub.
 */
internal fun placeholderFor(maxDigits: Int): String {
    val sample = "612345678901234".take(minOf(maxDigits, 12))
    val groups = sample.chunked(3).toMutableList()
    if (groups.size > 1 && groups.last().length == 1) {
        val last = groups.removeAt(groups.lastIndex)
        groups[groups.lastIndex] = groups.last() + last
    }
    return groups.joinToString(" ")
}

/** Barcelona is the market; Spain is the sensible default code. */
internal const val DEFAULT_DIAL = "+34"
