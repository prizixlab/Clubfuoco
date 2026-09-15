package com.clubfuoco.app.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.BuildConfig
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.AuthField
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.FormError
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.features.auth.FuocoTextField
import com.clubfuoco.app.features.auth.GenderPicker
import com.clubfuoco.app.models.Gender
import com.clubfuoco.app.features.location.LocationMode
import com.clubfuoco.app.features.location.LocationPermissionSheet
import com.clubfuoco.app.stores.AuthStore
import com.clubfuoco.app.stores.LocaleStore
import com.clubfuoco.app.stores.ThemeStore
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * Settings — editable profile fields, language, appearance, sign out and
 * account deletion. Port of `SettingsView`.
 */
@Composable
fun SettingsScreen(
    auth: AuthStore,
    api: ApiClient,
    localeStore: LocaleStore,
    themeStore: ThemeStore,
    onBack: () -> Unit,
) {
    var showLocationSheet by remember { mutableStateOf(false) }

    if (showLocationSheet) {
        LocationPermissionSheet(LocationMode.ARRIVAL) { showLocationSheet = false }
        return
    }

    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var fullName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var gender by remember { mutableStateOf<Gender?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var savedFlash by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        if (!loaded) {
            auth.refreshProfile()
            fullName = auth.profile?.fullName.orEmpty()
            phone = auth.profile?.phone.orEmpty()
            gender = Gender.from(auth.profile?.gender)
            loaded = true
        }
    }

    val hasChanges = fullName != auth.profile?.fullName.orEmpty() ||
        phone != auth.profile?.phone.orEmpty() ||
        (gender?.raw ?: "") != auth.profile?.gender.orEmpty()

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        BackChevronButton(onClick = onBack)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                stringResource(R.string.settings_yourAccount),
                fontFamily = InstrumentSerif, fontSize = 34.sp, color = Theme.ink,
            )
            Text(
                stringResource(R.string.settings_subtitle),
                fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
            )
        }

        Section(stringResource(R.string.settings_personal)) {
            AuthField(stringResource(R.string.settings_fullName)) {
                FuocoTextField(fullName, { fullName = it }, Modifier.weight(1f))
            }
            AuthField(stringResource(R.string.settings_phone)) {
                FuocoTextField(
                    phone, { phone = it }, Modifier.weight(1f),
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Phone,
                )
            }
            Text(
                stringResource(R.string.settings_gender),
                fontFamily = Geist, fontWeight = FontWeight.Medium,
                fontSize = 13.sp, color = Theme.ink,
            )
            GenderPicker(gender) { gender = it }

            errorMessage?.let { FormError(it) }

            PrimaryButton(
                title = stringResource(
                    if (savedFlash) R.string.settings_saved else R.string.settings_save,
                ),
                loading = saving,
                enabled = hasChanges,
            ) {
                saving = true
                errorMessage = null
                scope.launch {
                    runCatching {
                        auth.updateProfile(
                            "full_name" to fullName.trim().ifEmpty { null },
                            "phone" to phone.trim().ifEmpty { null },
                            "gender" to gender?.raw,
                        )
                    }.onSuccess {
                        savedFlash = true
                    }.onFailure { errorMessage = it.message }
                    saving = false
                }
            }
        }

        Section(stringResource(R.string.settings_language)) {
            LocaleStore.Setting.entries.forEach { setting ->
                val labelKey = when (setting) {
                    LocaleStore.Setting.DEVICE -> "settings_lang_device"
                    else -> "settings_lang_${setting.tag}"
                }
                ChoiceRow(
                    label = resolve(context, labelKey),
                    selected = localeStore.setting == setting,
                ) { localeStore.set(setting) }
            }
        }

        Section(stringResource(R.string.settings_theme)) {
            ThemeStore.Setting.entries.forEach { setting ->
                ChoiceRow(
                    label = resolve(context, "settings_theme_${setting.raw}"),
                    selected = themeStore.setting == setting,
                ) { themeStore.set(setting) }
            }
        }

        // The arrival geofence, reachable after the fact. Android only grants
        // background location from Settings, so this is the one place someone
        // who declined the first time can find their way back to it.
        Section(stringResource(R.string.location_title)) {
            ChoiceRow(
                label = stringResource(R.string.location_enable),
                selected = false,
            ) { showLocationSheet = true }
        }

        Section(stringResource(R.string.settings_accountActions)) {
            ChoiceRow(stringResource(R.string.settings_signOut), selected = false) {
                scope.launch { auth.signOut() }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickableUnlessBusy(enabled = !deleting) { confirmDelete = !confirmDelete }
                    .padding(vertical = 12.dp),
            ) {
                Text(
                    stringResource(
                        if (deleting) R.string.settings_deleting else R.string.settings_deleteAccount,
                    ),
                    fontFamily = Geist, fontSize = 14.sp, color = Theme.wine,
                )
                Text(
                    stringResource(R.string.settings_permanent),
                    fontFamily = Geist, fontSize = 11.sp, color = Theme.fadedSand,
                )
            }
            if (confirmDelete) {
                Text(
                    stringResource(R.string.settings_deleteWarning),
                    fontFamily = Geist, fontSize = 12.sp, color = Theme.stone,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ChoiceRow(
                        stringResource(R.string.settings_keepAccount),
                        selected = false,
                        modifier = Modifier.weight(1f),
                    ) { confirmDelete = false }
                    ChoiceRow(
                        stringResource(R.string.settings_yesDelete),
                        selected = true,
                        modifier = Modifier.weight(1f),
                    ) {
                        deleting = true
                        scope.launch {
                            @Serializable
                            data class DeleteResult(val deleted: Boolean? = null)
                            runCatching {
                                api.post("/api/account/delete", DeleteResult.serializer())
                            }.onSuccess { auth.signOut() }
                                .onFailure {
                                    errorMessage = it.message
                                    deleting = false
                                }
                        }
                    }
                }
            }
        }

        Text(
            "Club Fuoco · v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
            fontFamily = GeistMono, fontSize = 10.sp, letterSpacing = 1.4.sp,
            color = Theme.fadedSand,
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
        )
    }
}

/** Resolves a generated string key by name — keeps the enums authoritative. */
private fun resolve(context: android.content.Context, key: String): String {
    val id = context.resources.getIdentifier(key, "string", context.packageName)
    return if (id != 0) context.getString(id) else key
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Kicker(title, color = Theme.fadedSand, size = 9.sp)
        Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.hairline))
        content()
    }
}

@Composable
private fun ChoiceRow(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(CircleShape)
            .background(if (selected) Theme.wine else Theme.surface)
            .clickableUnlessBusy(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            label,
            fontFamily = Geist,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            fontSize = 14.sp,
            color = if (selected) Theme.cream else Theme.ink,
        )
    }
}
