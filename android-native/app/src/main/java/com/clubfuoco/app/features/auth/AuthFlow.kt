package com.clubfuoco.app.features.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.clubfuoco.app.R
import com.clubfuoco.app.core.designsystem.Geist
import com.clubfuoco.app.core.designsystem.InstrumentSerif
import com.clubfuoco.app.core.designsystem.Kicker
import com.clubfuoco.app.core.designsystem.Theme
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.stores.AuthStore

/**
 * Container for the signed-out experience: dark splash → login / signup /
 * forgot-password. Port of `AuthFlowView`, replacing Next's (auth) route group.
 */
object AuthRoute {
    const val WELCOME = "welcome"
    const val LOGIN = "login"
    const val SIGNUP = "signup"
    const val FORGOT = "forgot"
}

@Composable
fun AuthFlow(auth: AuthStore, api: ApiClient) {
    val nav = rememberNavController()

    NavHost(navController = nav, startDestination = AuthRoute.WELCOME) {
        composable(AuthRoute.WELCOME) {
            WelcomeScreen(
                auth = auth,
                onSignUp = { nav.navigate(AuthRoute.SIGNUP) },
                onSignIn = { nav.navigate(AuthRoute.LOGIN) },
            )
        }
        composable(AuthRoute.LOGIN) {
            LoginScreen(
                auth = auth,
                onBack = { nav.popBackStack() },
                onSignUp = { nav.navigate(AuthRoute.SIGNUP) },
                onForgotPassword = { nav.navigate(AuthRoute.FORGOT) },
            )
        }
        composable(AuthRoute.SIGNUP) {
            SignupScreen(
                auth = auth,
                api = api,
                onBack = { nav.popBackStack() },
                onSignIn = { nav.navigate(AuthRoute.LOGIN) },
            )
        }
        composable(AuthRoute.FORGOT) {
            ForgotPasswordScreen(auth = auth, onBack = { nav.popBackStack() })
        }
    }
}

/**
 * The complete-profile gate for a returning user whose row predates a required
 * field. Port of `CompleteProfileView`.
 *
 * This is NOT part of the signed-out flow — it sits above the whole app, because
 * an existing session with an incomplete profile has to be stopped before it
 * reaches the tabs.
 */
@Composable
fun CompleteProfileScreen(auth: AuthStore) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Theme.cream)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Kicker("N° 02 · Profilo", modifier = Modifier.padding(bottom = 16.dp))

        Text(
            stringResource(R.string.signup_whensBirthday),
            fontFamily = InstrumentSerif,
            fontStyle = FontStyle.Italic,
            fontSize = 40.sp,
            lineHeight = 44.sp,
            color = Theme.ink,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        Text(
            stringResource(R.string.signup_birthdaySubtitle),
            fontFamily = Geist,
            fontSize = 13.5.sp,
            color = Theme.stone,
            modifier = Modifier.padding(bottom = 32.dp),
        )

        ProfileFields(auth = auth, onDone = { auth.finishOnboarding() })
    }
}
