package com.clubfuoco.app.features.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.AuthField
import com.clubfuoco.app.core.designsystem.FormError
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.models.Gender
import com.clubfuoco.app.stores.AuthStore
import kotlinx.coroutines.launch
import java.time.LocalDate

/**
 * Birthday + gender — the two fields that decide `UserProfile.isComplete`.
 *
 * Shared by the signup wizard and the complete-profile gate on purpose: they ask
 * for exactly the same things, and one implementation means the 18+ rule and the
 * gender copy cannot drift between them.
 */
@Composable
fun ProfileFields(
    auth: AuthStore,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var day by remember { mutableStateOf("") }
    var month by remember { mutableStateOf("") }
    var year by remember { mutableStateOf("") }
    var gender by remember { mutableStateOf<Gender?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val underageMessage = stringResource(R.string.signup_underage)
    val genderMessage = stringResource(R.string.signup_genderError)

    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text(
            stringResource(R.string.signup_birthdaySubtitle),
            fontFamily = Geist,
            fontSize = 13.sp,
            color = Theme.stone,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AuthField(stringResource(R.string.signup_day), modifier = Modifier.weight(1f)) {
                FuocoTextField(
                    day, { day = it.filter(Char::isDigit).take(2) }, Modifier.weight(1f),
                    placeholder = "DD", keyboardType = KeyboardType.Number,
                )
            }
            AuthField(stringResource(R.string.signup_month), modifier = Modifier.weight(1f)) {
                FuocoTextField(
                    month, { month = it.filter(Char::isDigit).take(2) }, Modifier.weight(1f),
                    placeholder = "MM", keyboardType = KeyboardType.Number,
                )
            }
            AuthField(stringResource(R.string.signup_year), modifier = Modifier.weight(1.4f)) {
                FuocoTextField(
                    year, { year = it.filter(Char::isDigit).take(4) }, Modifier.weight(1f),
                    placeholder = "YYYY", keyboardType = KeyboardType.Number,
                )
            }
        }

        Text(
            stringResource(R.string.signup_genderLabel),
            fontFamily = Geist,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = Theme.ink,
        )
        GenderPicker(selection = gender, onSelect = { gender = it })

        error?.let { FormError(it) }

        PrimaryButton(
            title = stringResource(R.string.signup_continue),
            loading = busy,
            enabled = day.isNotBlank() && month.isNotBlank() && year.length == 4,
        ) {
            val birthday = parseBirthday(day, month, year)
            when {
                birthday == null -> error = underageMessage
                !isAdult(birthday) -> error = underageMessage
                gender == null -> error = genderMessage
                else -> {
                    busy = true
                    error = null
                    scope.launch {
                        runCatching {
                            auth.updateProfile(
                                "birthday" to birthday.toString(),
                                "gender" to gender!!.raw,
                            )
                        }.onSuccess { onDone() }
                            .onFailure { error = it.message ?: "Could not save" }
                        busy = false
                    }
                }
            }
        }
    }
}

/**
 * Three-pill selector. Two-row layout: male/female share the top row at equal
 * width, and "prefer not to say" gets its own full-width row so its longer label
 * never clips — the same compromise the iOS `GenderPicker` settled on.
 */
@Composable
fun GenderPicker(selection: Gender?, onSelect: (Gender) -> Unit) {
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GenderChip(Gender.MALE, selection, onSelect, Modifier.weight(1f))
            GenderChip(Gender.FEMALE, selection, onSelect, Modifier.weight(1f))
        }
        GenderChip(Gender.PREFER_NOT_TO_SAY, selection, onSelect, Modifier.fillMaxWidth())
    }
}

@Composable
private fun GenderChip(
    gender: Gender,
    selection: Gender?,
    onSelect: (Gender) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val selected = selection == gender
    // Gender labels are keyed `signup_gender_<raw>` in the catalog; resolving by
    // name keeps the enum as the single source of truth for the mapping.
    val resId = remember(gender) {
        context.resources.getIdentifier(gender.stringKey, "string", context.packageName)
    }
    Box(
        modifier
            .height(44.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(if (selected) Theme.wine else Theme.surface)
            .border(
                1.dp,
                if (selected) Theme.wine else Theme.hairline,
                RoundedCornerShape(11.dp),
            )
            .clickableUnlessBusy { onSelect(gender) },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (resId != 0) stringResource(resId) else gender.raw,
            fontFamily = Geist,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = if (selected) Theme.cream else Theme.ink,
        )
    }
}

private fun parseBirthday(day: String, month: String, year: String): LocalDate? = runCatching {
    LocalDate.of(year.toInt(), month.toInt(), day.toInt())
}.getOrNull()

/** 18+ is a hard gate — the venues' licences depend on it, not just our policy. */
private fun isAdult(birthday: LocalDate): Boolean =
    !birthday.isAfter(LocalDate.now().minusYears(18))
