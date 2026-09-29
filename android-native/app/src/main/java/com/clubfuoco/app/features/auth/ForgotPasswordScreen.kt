package com.clubfuoco.app.features.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.AuthField
import com.clubfuoco.app.core.designsystem.BackChevronButton
import com.clubfuoco.app.core.designsystem.FormError
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.stores.AuthStore
import kotlinx.coroutines.launch

/**
 * Password recovery — port of `ForgotPasswordView`.
 *
 * Three steps: send a code → verify it (which mints a recovery session) → set
 * the new password. Deliberately the OTP flow rather than a magic link, so it
 * rides the same email delivery the signup flow already depends on.
 *
 * Requires the Supabase "Reset Password" template to include {{ .Token }}, or no
 * code ever appears in the email.
 */
@Composable
fun ForgotPasswordScreen(auth: AuthStore, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var stage by remember { mutableStateOf(Stage.EMAIL) }
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        BackChevronButton(Modifier.padding(bottom = 24.dp)) {
            if (stage == Stage.EMAIL) onBack() else stage = Stage.EMAIL
        }

        Kicker(stringResource(R.string.forgot_kicker), modifier = Modifier.padding(bottom = 16.dp))

        Text(
            buildAnnotatedString {
                append(stringResource(R.string.forgot_title))
                append(" ")
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                    append(stringResource(R.string.forgot_titleEm))
                }
            },
            fontFamily = InstrumentSerif,
            fontSize = 44.sp,
            lineHeight = 48.sp,
            color = Theme.ink,
            modifier = Modifier.padding(bottom = 10.dp),
        )

        Text(
            stringResource(
                when (stage) {
                    Stage.EMAIL -> R.string.forgot_emailSub
                    Stage.CODE -> R.string.forgot_codeSub
                    Stage.PASSWORD -> R.string.forgot_passwordSub
                },
                if (stage == Stage.CODE) email else "",
            ),
            fontFamily = Geist,
            fontSize = 13.5.sp,
            color = Theme.stone,
            modifier = Modifier.padding(bottom = 32.dp),
        )

        Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
            when (stage) {
                Stage.EMAIL -> {
                    AuthField(label = stringResource(R.string.auth_email)) {
                        FuocoTextField(
                            email, { email = it }, Modifier.weight(1f),
                            placeholder = "you@fuoco.club",
                            keyboardType = KeyboardType.Email,
                        )
                    }
                    error?.let { FormError(it) }
                    PrimaryButton(
                        title = stringResource(
                            if (busy) R.string.forgot_working else R.string.forgot_sendCode,
                        ),
                        loading = busy,
                        enabled = email.isNotBlank(),
                    ) {
                        busy = true; error = null
                        scope.launch {
                            runCatching { auth.sendPasswordReset(email.trim()) }
                                .onSuccess { stage = Stage.CODE }
                                .onFailure { error = it.message }
                            busy = false
                        }
                    }
                }

                Stage.CODE -> {
                    AuthField(label = stringResource(R.string.forgot_codeLabel)) {
                        FuocoTextField(
                            code, { code = it.filter(Char::isDigit).take(8) }, Modifier.weight(1f),
                            placeholder = "••••••",
                            keyboardType = KeyboardType.NumberPassword,
                        )
                    }
                    error?.let { FormError(it) }
                    PrimaryButton(
                        title = stringResource(
                            if (busy) R.string.forgot_working else R.string.forgot_verify,
                        ),
                        loading = busy,
                        enabled = code.length >= 6,
                    ) {
                        busy = true; error = null
                        scope.launch {
                            runCatching { auth.verifyPasswordRecoveryOtp(email.trim(), code) }
                                .onSuccess { stage = Stage.PASSWORD }
                                .onFailure { error = it.message }
                            busy = false
                        }
                    }
                    Text(
                        stringResource(R.string.forgot_resend),
                        fontFamily = Geist, fontSize = 13.sp, color = Theme.wine,
                        modifier = Modifier.clickableUnlessBusy {
                            scope.launch { runCatching { auth.sendPasswordReset(email.trim()) } }
                        },
                    )
                }

                Stage.PASSWORD -> {
                    AuthField(label = stringResource(R.string.forgot_newPassword)) {
                        FuocoTextField(
                            password, { password = it }, Modifier.weight(1f),
                            placeholder = "••••••••",
                            keyboardType = KeyboardType.Password,
                            visualTransformation = PasswordVisualTransformation(),
                        )
                    }
                    error?.let { FormError(it) }
                    PrimaryButton(
                        title = stringResource(
                            if (busy) R.string.forgot_working else R.string.forgot_setPassword,
                        ),
                        loading = busy,
                        enabled = password.length >= 8,
                    ) {
                        busy = true; error = null
                        scope.launch {
                            runCatching { auth.updatePassword(password) }
                                .onFailure { error = it.message }
                            busy = false
                            // On success onboardingInProgress clears and the root
                            // drops the (now signed-in) user into the app.
                        }
                    }
                }
            }
        }
    }
}

private enum class Stage { EMAIL, CODE, PASSWORD }
