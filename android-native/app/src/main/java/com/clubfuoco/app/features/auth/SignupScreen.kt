package com.clubfuoco.app.features.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
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
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.GeistMono
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.PrimaryButton
import com.clubfuoco.app.core.designsystem.SegmentedProgress
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.designsystem.clickableUnlessBusy
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.features.onboarding.SurveyScreen
import com.clubfuoco.app.stores.AuthStore
import com.clubfuoco.app.stores.SignupConflict
import kotlinx.coroutines.launch

/**
 * The signup wizard — port of `SignupView`.
 *
 * Steps: details → email OTP → birthday + gender → the survey offer. The
 * membership step from the iOS wizard is deliberately absent: StoreKit and the
 * paid tiers were removed from the shipping iOS app, so there is nothing to
 * choose.
 *
 * The wizard signs the user IN partway through (after OTP), which is why
 * `AuthStore.onboardingInProgress` exists — without it the root would swap to
 * the main app mid-wizard and strand the remaining steps.
 */
@Composable
fun SignupScreen(
    auth: AuthStore,
    api: ApiClient,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var step by remember { mutableStateOf(SignupStep.DETAILS) }
    var showSurvey by remember { mutableStateOf(false) }

    // The survey takes the whole screen rather than sitting inside the wizard
    // frame: it has its own seven-step progress, and nesting two progress bars
    // would say nothing useful twice.
    if (showSurvey) {
        SurveyScreen(
            api = api,
            onComplete = { auth.finishOnboarding() },
            onCancel = { showSurvey = false },
        )
        return
    }
    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var acceptedTos by remember { mutableStateOf(false) }
    var otp by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Hoisted: stringResource is @Composable and cannot be read from inside a
    // click handler.
    val tosMessage = stringResource(R.string.signup_tosError)

    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        BackChevronButton(Modifier.padding(bottom = 16.dp)) {
            if (step == SignupStep.DETAILS) onBack() else step = step.previous()
        }

        SegmentedProgress(
            step = step.ordinal + 1,
            total = SignupStep.entries.size,
            modifier = Modifier.padding(bottom = 24.dp),
        )

        Kicker(
            stringResource(R.string.signup_stepOf, step.ordinal + 1, SignupStep.entries.size),
            modifier = Modifier.padding(bottom = 16.dp),
        )

        when (step) {
            SignupStep.DETAILS -> {
                Headline(
                    plain = stringResource(R.string.signup_yourDetails),
                    italic = stringResource(R.string.signup_yourDetailsEm),
                    subtitle = stringResource(R.string.signup_detailsSubtitle),
                )

                Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AuthField(
                            label = stringResource(R.string.signup_firstName),
                            modifier = Modifier.weight(1f),
                        ) {
                            FuocoTextField(firstName, { firstName = it }, Modifier.weight(1f))
                        }
                        AuthField(
                            label = stringResource(R.string.signup_lastName),
                            modifier = Modifier.weight(1f),
                        ) {
                            FuocoTextField(lastName, { lastName = it }, Modifier.weight(1f))
                        }
                    }

                    AuthField(label = stringResource(R.string.auth_email)) {
                        FuocoTextField(
                            email, { email = it }, Modifier.weight(1f),
                            placeholder = "you@fuoco.club",
                            keyboardType = KeyboardType.Email,
                        )
                    }

                    AuthField(label = stringResource(R.string.auth_password)) {
                        FuocoTextField(
                            password, { password = it }, Modifier.weight(1f),
                            placeholder = "••••••••",
                            keyboardType = KeyboardType.Password,
                            visualTransformation = if (showPassword) VisualTransformation.None
                            else PasswordVisualTransformation(),
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

                    Text(
                        stringResource(R.string.signup_passwordHint),
                        fontFamily = Geist,
                        fontSize = 11.sp,
                        color = Theme.fadedSand,
                    )

                    TosRow(accepted = acceptedTos, onToggle = { acceptedTos = !acceptedTos })

                    error?.let { FormError(it) }

                    PrimaryButton(
                        title = stringResource(R.string.signup_continue),
                        loading = busy,
                        enabled = firstName.isNotBlank() && lastName.isNotBlank() &&
                            email.isNotBlank() && password.length >= 8,
                    ) {
                        if (!acceptedTos) {
                            error = tosMessage
                            return@PrimaryButton
                        }
                        busy = true
                        error = null
                        scope.launch {
                            runCatching {
                                auth.signUp(
                                    email = email.trim(),
                                    password = password,
                                    firstName = firstName.trim(),
                                    lastName = lastName.trim(),
                                )
                            }.onSuccess { needsOtp ->
                                step = if (needsOtp) SignupStep.VERIFY else SignupStep.PROFILE
                            }.onFailure {
                                error = when (it) {
                                    is SignupConflict.EmailTaken -> it.message
                                    else -> it.message ?: "Sign up failed"
                                }
                            }
                            busy = false
                        }
                    }

                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            stringResource(R.string.signup_alreadyMember),
                            fontFamily = Geist, fontSize = 13.sp, color = Theme.stone,
                        )
                        Text(
                            " " + stringResource(R.string.signup_signInArrow),
                            fontFamily = Geist, fontSize = 13.sp, color = Theme.wine,
                            modifier = Modifier.clickableUnlessBusy(onClick = onSignIn),
                        )
                    }
                }
            }

            SignupStep.VERIFY -> {
                Headline(
                    plain = stringResource(R.string.otp_title),
                    italic = stringResource(R.string.otp_titleEm),
                    subtitle = stringResource(R.string.otp_body, email),
                )

                Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    AuthField(label = stringResource(R.string.forgot_codeLabel)) {
                        FuocoTextField(
                            otp, { otp = it.filter(Char::isDigit).take(8) }, Modifier.weight(1f),
                            placeholder = "••••••",
                            keyboardType = KeyboardType.NumberPassword,
                        )
                    }

                    error?.let { FormError(it) }

                    PrimaryButton(
                        title = stringResource(
                            if (busy) R.string.otp_verifying else R.string.otp_verify,
                        ),
                        loading = busy,
                        enabled = otp.length >= 6,
                    ) {
                        busy = true
                        error = null
                        scope.launch {
                            runCatching { auth.verifySignupOtp(email.trim(), otp) }
                                .onSuccess { step = SignupStep.PROFILE }
                                .onFailure { error = it.message ?: "Invalid code" }
                            busy = false
                        }
                    }

                    Text(
                        stringResource(R.string.otp_resend),
                        fontFamily = Geist,
                        fontSize = 13.sp,
                        color = Theme.wine,
                        modifier = Modifier.clickableUnlessBusy {
                            scope.launch { runCatching { auth.resendSignupOtp(email.trim()) } }
                        },
                    )
                }
            }

            // Birthday + gender share the complete-profile screen: they are the
            // same two required fields, and keeping one implementation means the
            // 18+ rule and the gender copy cannot drift between the wizard and
            // the returning-user gate.
            SignupStep.PROFILE -> ProfileFields(
                auth = auth,
                onDone = { step = SignupStep.PERSONALIZE },
            )

            SignupStep.PERSONALIZE -> {
                Headline(
                    plain = stringResource(R.string.survey_offerTitle),
                    italic = stringResource(R.string.survey_offerItalic),
                    subtitle = stringResource(R.string.survey_offerSubtitle),
                )

                Row(
                    Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ChoiceCard(
                        overline = stringResource(R.string.survey_offerRecommended),
                        headline = stringResource(R.string.survey_offerYes),
                        cta = stringResource(R.string.survey_offerStart),
                        dark = true,
                        modifier = Modifier.weight(1f),
                    ) { showSurvey = true }

                    ChoiceCard(
                        overline = stringResource(R.string.survey_offerNoThanks),
                        headline = stringResource(R.string.survey_offerTakeMeIn),
                        cta = stringResource(R.string.survey_offerGoExplore),
                        dark = false,
                        modifier = Modifier.weight(1f),
                    ) { auth.finishOnboarding() }
                }
            }
        }
    }
}

enum class SignupStep {
    DETAILS, VERIFY, PROFILE, PERSONALIZE;

    fun previous(): SignupStep = entries.getOrElse(ordinal - 1) { DETAILS }
}

/**
 * One of the two cards on the survey offer. The recommended side is the dark,
 * warm one — the only place in the wizard that looks like the brand's night
 * surfaces, which is the whole reason it reads as the default.
 */
@Composable
private fun ChoiceCard(
    overline: String,
    headline: String,
    cta: String,
    dark: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val ember = Color(0xFFFFE8B5)

    Column(
        modifier
            .defaultMinSize(minHeight = 300.dp)
            .clip(RoundedCornerShape(20.dp))
            .then(
                if (dark) {
                    Modifier.background(
                        Brush.linearGradient(
                            listOf(
                                Color(0xFF1A1410),
                                Color(0xFF2A1810),
                                Color(0xFF5B1F1C),
                                Theme.wine,
                            ),
                        ),
                    )
                } else {
                    Modifier.background(Theme.surface)
                },
            )
            .border(
                1.dp,
                if (dark) Color(0xFFFFE0A5).copy(alpha = 0.18f) else Theme.hairline,
                RoundedCornerShape(20.dp),
            )
            .clickableUnlessBusy(onClick = onClick)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            overline.uppercase(),
            fontFamily = GeistMono, fontSize = 8.5.sp, letterSpacing = 1.8.sp,
            color = if (dark) ember.copy(alpha = 0.7f) else Theme.sand,
        )
        Text(
            headline,
            fontFamily = InstrumentSerif, fontStyle = FontStyle.Italic,
            fontSize = 26.sp, lineHeight = 30.sp,
            color = if (dark) FuocoFixed.parchment else Theme.ink,
        )
        Spacer(Modifier.weight(1f))
        Text(
            cta,
            fontFamily = Geist, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
            color = if (dark) ember else Theme.wine,
        )
    }
}

@Composable
private fun Headline(plain: String, italic: String, subtitle: String) {
    Text(
        buildAnnotatedString {
            append(plain)
            append(" ")
            withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(italic) }
        },
        fontFamily = InstrumentSerif,
        fontSize = 44.sp,
        lineHeight = 48.sp,
        color = Theme.ink,
        modifier = Modifier.padding(bottom = 10.dp),
    )
    Text(
        subtitle,
        fontFamily = Geist,
        fontSize = 13.5.sp,
        color = Theme.stone,
        modifier = Modifier.padding(bottom = 32.dp),
    )
}

@Composable
private fun TosRow(accepted: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickableUnlessBusy(onClick = onToggle),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            if (accepted) "☑" else "☐",
            fontSize = 18.sp,
            color = if (accepted) Theme.wine else Theme.sand,
        )
        Text(
            stringResource(R.string.signup_tosPrefix),
            fontFamily = Geist,
            fontSize = 12.sp,
            color = Theme.stone,
        )
    }
}
