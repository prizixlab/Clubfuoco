package com.clubfuoco.app.features.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.clubfuoco.app.stores.AuthStore
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource

/**
 * Port of (auth)/login and `LoginView` — cream cinema theme, mono kicker, serif
 * headline, fields with SHOW/HIDE, wine CTA, OAuth below.
 */
@Composable
fun LoginScreen(
    auth: AuthStore,
    onBack: () -> Unit,
    onSignUp: () -> Unit,
    onForgotPassword: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        BackChevronButton(Modifier.padding(bottom = 24.dp), onClick = onBack)

        Kicker("N° 01 · Accesso", modifier = Modifier.padding(bottom = 16.dp))

        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                    append(stringResource(R.string.login_welcome))
                }
                append(" ")
                append(stringResource(R.string.login_welcomeBack))
            },
            fontFamily = InstrumentSerif,
            fontSize = 52.sp,
            lineHeight = 56.sp,
            color = Theme.ink,
            modifier = Modifier.padding(bottom = 10.dp),
        )

        Text(
            stringResource(R.string.login_subtitle),
            fontFamily = Geist,
            fontSize = 13.5.sp,
            color = Theme.stone,
            modifier = Modifier.padding(bottom = 36.dp),
        )

        Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
            AuthField(label = stringResource(R.string.auth_email)) {
                FuocoTextField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = "you@fuoco.club",
                    keyboardType = KeyboardType.Email,
                    modifier = Modifier.weight(1f),
                )
            }

            AuthField(label = stringResource(R.string.auth_password)) {
                FuocoTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = "••••••••",
                    keyboardType = KeyboardType.Password,
                    visualTransformation = if (showPassword) VisualTransformation.None
                    else PasswordVisualTransformation(),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    stringResource(
                        if (showPassword) R.string.auth_hide else R.string.auth_show,
                    ).uppercase(),
                    fontFamily = GeistMono,
                    fontSize = 10.sp,
                    letterSpacing = 1.6.sp,
                    color = Theme.wine,
                    modifier = Modifier.clickableUnlessBusy { showPassword = !showPassword },
                )
            }

            errorMessage?.let { FormError(it) }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Text(
                    stringResource(R.string.login_forgotPassword),
                    fontFamily = Geist,
                    fontSize = 13.sp,
                    color = Theme.wine,
                    modifier = Modifier.clickableUnlessBusy(onClick = onForgotPassword),
                )
            }

            PrimaryButton(
                title = stringResource(
                    if (submitting) R.string.login_signingIn else R.string.login_signIn,
                ),
                loading = submitting,
                enabled = email.isNotBlank() && password.isNotBlank(),
            ) {
                submitting = true
                errorMessage = null
                scope.launch {
                    runCatching { auth.signIn(email.trim(), password) }
                        .onFailure { errorMessage = it.message ?: "Sign in failed" }
                    // On success the session flow flips the root to the main app.
                    submitting = false
                }
            }
        }

        OAuthButtons(
            auth = auth,
            modifier = Modifier.padding(top = 24.dp),
            onNeedsProfile = { /* routed by the root's complete-profile gate */ },
        )

        Row(
            Modifier.fillMaxWidth().padding(top = 24.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.login_noAccount),
                fontFamily = Geist,
                fontSize = 13.sp,
                color = Theme.stone,
            )
            Spacer(Modifier.padding(horizontal = 2.dp))
            Text(
                stringResource(R.string.login_createOne),
                fontFamily = Geist,
                fontSize = 13.sp,
                color = Theme.wine,
                modifier = Modifier.clickableUnlessBusy(onClick = onSignUp),
            )
        }
    }
}

/**
 * The app's text field. Deliberately `BasicTextField` rather than Material's
 * `TextField`: the container, label and border are already drawn by [AuthField],
 * and Material would stack its own decoration box inside that.
 */
@Composable
fun FuocoTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    singleLine: Boolean = true,
) {
    androidx.compose.foundation.layout.Box(modifier, contentAlignment = Alignment.CenterStart) {
        if (value.isEmpty() && placeholder.isNotEmpty()) {
            Text(
                placeholder,
                fontFamily = Geist,
                fontSize = 16.sp,
                color = Theme.fadedSand,
            )
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            textStyle = TextStyle(
                fontFamily = Geist,
                fontSize = 16.sp,
                color = Theme.ink,
                fontWeight = FontWeight.Normal,
            ),
            visualTransformation = visualTransformation,
            keyboardOptions = KeyboardOptions(
                keyboardType = keyboardType,
                imeAction = imeAction,
            ),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(Theme.ember),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
