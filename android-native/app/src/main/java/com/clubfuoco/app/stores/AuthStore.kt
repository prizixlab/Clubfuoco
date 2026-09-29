package com.clubfuoco.app.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.clubfuoco.app.core.notifications.PushRegistrar
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.core.supabase.SupabaseService
import com.clubfuoco.app.models.UserProfile
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.providers.builtin.IDToken
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Signup pre-flight conflicts, surfaced on the details step. */
sealed class SignupConflict(message: String) : Exception(message) {
    data object EmailTaken :
        SignupConflict("This email is already registered. Try signing in instead.")

    data object PhoneTaken :
        SignupConflict("This phone number is already linked to another account.")
}

/**
 * Publishes the Supabase user, the resolved profile, and a loading flag while
 * the initial session check is in flight. Port of `AuthStore.swift`, which
 * mirrors the web AuthContext.
 *
 * Also owns the signup/OAuth onboarding flow: while [onboardingInProgress] is
 * true the root keeps showing the auth flow even though a session already
 * exists, because the signup wizard signs the user in mid-flow, before the
 * birthday and membership steps.
 */
class AuthStore(
    private val supabase: SupabaseService,
    val queries: Queries,
    private val scope: CoroutineScope,
) {
    enum class State { LOADING, SIGNED_OUT, SIGNED_IN }

    var state: State by mutableStateOf(State.LOADING)
        private set

    var user: UserInfo? by mutableStateOf(null)
        private set

    var profile: UserProfile? by mutableStateOf(null)
        private set

    var onboardingInProgress: Boolean by mutableStateOf(false)

    /**
     * Session-less guest browsing. The intended guest flow is an anonymous
     * Supabase session, but anonymous sign-up 500s in production (a DB trigger),
     * and the web splash swallows that and routes guests in anyway — so "guest"
     * has to work with no session at all.
     *
     * Deliberately not persisted: a relaunched guest lands back on the splash,
     * same as web.
     */
    var guestMode: Boolean by mutableStateOf(false)
        private set

    val isAnonymous: Boolean get() = user?.isAnonymous == true

    /**
     * THE gate for anything that belongs to a person: saving a venue, joining a
     * guestlist, booking, tickets, friends.
     *
     * Both guest shapes must fail it — a session-less guest (`user == null`) and
     * an anonymous Supabase session. Call sites used to spell this out
     * individually and disagreed, which let an anonymous guest write rows
     * against a throwaway id that is orphaned the moment they make a real
     * account.
     *
     * Browsing deliberately does NOT consult this — the catalogue stays open to
     * everyone (Play and App Store both expect that); only account actions are
     * gated.
     */
    val hasAccount: Boolean get() = user != null && !isAnonymous && !guestMode

    /**
     * Subscribe to auth changes. The flow replays the stored session first, so
     * this also performs cold-start hydration.
     */
    fun start() {
        scope.launch {
            supabase.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> {
                        user = status.session.user
                        // Show the app immediately; resolve the profile in the
                        // background, same as AuthContext.
                        state = State.SIGNED_IN
                        // The iOS app never re-registers push after signup, so a
                        // fresh install gets no token until the second launch.
                        // Doing it here is the fix.
                        PushRegistrar.onSignedIn()
                        scope.launch { refreshProfile() }
                    }

                    is SessionStatus.NotAuthenticated -> {
                        user = null
                        profile = null
                        onboardingInProgress = false
                        state = State.SIGNED_OUT
                    }

                    is SessionStatus.Initializing -> state = State.LOADING
                    else -> Unit
                }
            }
        }
    }

    /** Any failure falls back to a plain user, mirroring resolveAccountType(). */
    suspend fun refreshProfile() {
        profile = runCatching { queries.me() }.getOrNull()
        // Separate identities: a promoter account cannot use the consumer app.
        if (profile?.accountKind == "promoter") {
            runCatching { supabase.client.auth.signOut() }
            user = null
            profile = null
            onboardingInProgress = false
            state = State.SIGNED_OUT
        }
    }

    // ── Email / password ─────────────────────────────────────────────────────

    /**
     * Transparent retry on transient transport failures. Auth-level errors —
     * wrong password, unconfirmed email, rate-limited — surface immediately on
     * the first attempt so the user sees the real reason. Three attempts with
     * 600ms / 1500ms backoff, so most flaky-network sign-ins succeed silently.
     */
    suspend fun signIn(email: String, password: String) {
        val delays = listOf(600L, 1500L)
        var attempt = 0
        while (true) {
            try {
                withTimeout(AUTH_TIMEOUT_MS) {
                    supabase.client.auth.signInWith(Email) {
                        this.email = email
                        this.password = password
                    }
                }
                return
            } catch (e: Exception) {
                if (attempt < delays.size && isTransport(e)) {
                    kotlinx.coroutines.delay(delays[attempt])
                    attempt++
                } else {
                    throw e
                }
            }
        }
    }

    /**
     * Metadata mirrors the web payload so the DB trigger creates the same
     * `users` row. Returns true when an email OTP step is required.
     *
     * Throws [SignupConflict.EmailTaken] when Supabase signals the address is
     * taken: the confirmation-required response for an existing email returns a
     * faux user with `identities: []` (Supabase's anti-enumeration design), and
     * surfacing that is far better than sending the user to an OTP screen that
     * will never receive a code.
     */
    suspend fun signUp(
        email: String,
        password: String,
        firstName: String,
        lastName: String,
    ): Boolean {
        onboardingInProgress = true
        val fullName = "$firstName $lastName".trim()
        val result = withTimeout(AUTH_TIMEOUT_MS) {
            supabase.client.auth.signUpWith(Email) {
                this.email = email
                this.password = password
                data = buildJsonObject {
                    put("full_name", fullName)
                    put("first_name", firstName)
                    put("last_name", lastName)
                    put("account_type", "user")
                }
            }
        }

        if (result?.identities?.isEmpty() == true) {
            onboardingInProgress = false
            throw SignupConflict.EmailTaken
        }
        // A null session means Supabase wants the email confirmed first.
        return supabase.client.auth.currentSessionOrNull() == null
    }

    /**
     * Pre-flight phone uniqueness via the `check_phone_exists` RPC (a SECURITY
     * DEFINER function, so it bypasses RLS without exposing the phone column to
     * anon reads).
     *
     * Fails OPEN: if the RPC errors we let signup proceed, so a transient
     * network issue never blocks account creation.
     */
    suspend fun phoneIsTaken(phone: String): Boolean = runCatching {
        supabase.rpcBoolean("check_phone_exists", "p_phone" to phone)
    }.getOrElse { false }

    suspend fun verifySignupOtp(email: String, code: String) {
        withTimeout(AUTH_TIMEOUT_MS) {
            supabase.client.auth.verifyEmailOtp(
                type = io.github.jan.supabase.auth.OtpType.Email.SIGNUP,
                email = email,
                token = code,
            )
        }
    }

    suspend fun resendSignupOtp(email: String) {
        withTimeout(AUTH_TIMEOUT_MS) {
            supabase.client.auth.resendEmail(
                type = io.github.jan.supabase.auth.OtpType.Email.SIGNUP,
                email = email,
            )
        }
    }

    // ── Password recovery ────────────────────────────────────────────────────
    // Native OTP flow: send a recovery code → verify it (which mints a recovery
    // session) → set the new password. Mirrors the signup OTP path so it uses
    // the same email delivery the app already relies on.
    //
    // Requires the Supabase "Reset Password" template to include {{ .Token }},
    // or no code appears in the email.

    suspend fun sendPasswordReset(email: String) {
        withTimeout(AUTH_TIMEOUT_MS) {
            supabase.client.auth.resetPasswordForEmail(email)
        }
    }

    suspend fun verifyPasswordRecoveryOtp(email: String, code: String) {
        onboardingInProgress = true
        try {
            withTimeout(AUTH_TIMEOUT_MS) {
                supabase.client.auth.verifyEmailOtp(
                    type = io.github.jan.supabase.auth.OtpType.Email.RECOVERY,
                    email = email,
                    token = code,
                )
            }
        } catch (e: Exception) {
            onboardingInProgress = false
            throw e
        }
    }

    suspend fun updatePassword(newPassword: String) {
        withTimeout(AUTH_TIMEOUT_MS) {
            supabase.client.auth.updateUser { password = newPassword }
        }
        refreshProfile()
        onboardingInProgress = false
    }

    // ── Guest ────────────────────────────────────────────────────────────────

    /**
     * Try to mint an anonymous Supabase user so guests have a stable id — and
     * enter the app regardless, exactly like the web splash. Explore is public.
     */
    suspend fun signInAsGuest() {
        guestMode = true
        runCatching {
            withTimeout(GUEST_TIMEOUT_MS) { supabase.client.auth.signInAnonymously() }
        }
        // Anonymous sign-up currently 500s in production, and the timeout is
        // swallowed on purpose so guests are never blocked on an unreachable
        // auth host. Browsing works with no session at all.
    }

    /** Guest tapped "Create account" / "Sign in" — return to the auth flow. */
    fun exitGuestMode() {
        guestMode = false
    }

    // ── OAuth ────────────────────────────────────────────────────────────────

    /**
     * Google via an ID token from Credential Manager. Returns whether the
     * profile still needs completion.
     */
    suspend fun signInWithGoogleIdToken(idToken: String, rawNonce: String?): Boolean {
        onboardingInProgress = true
        withTimeout(AUTH_TIMEOUT_MS) {
            supabase.client.auth.signInWith(IDToken) {
                provider = Google
                this.idToken = idToken
                nonce = rawNonce
            }
        }
        return finishOAuth(providerName = null)
    }

    /**
     * Waits briefly for the post-signup DB trigger to create the `users` row on
     * a first-ever sign-in — without this the name update below no-ops.
     */
    private suspend fun finishOAuth(providerName: String?): Boolean {
        var row = runCatching { queries.me() }.getOrNull()
        repeat(3) {
            if (row == null) {
                kotlinx.coroutines.delay(400)
                row = runCatching { queries.me() }.getOrNull()
            }
        }
        if (!providerName.isNullOrEmpty() && row?.fullName.isNullOrEmpty()) {
            runCatching { queries.updateMe("full_name" to providerName) }
            row = runCatching { queries.me() }.getOrNull()
        }
        profile = row

        val incomplete = row?.isComplete != true
        if (!incomplete) onboardingInProgress = false
        return incomplete
    }

    // ── Profile updates ──────────────────────────────────────────────────────

    suspend fun updateProfile(vararg pairs: Pair<String, String?>) {
        queries.updateMe(*pairs)
        refreshProfile()
    }

    /** Onboarding finished — let the root switch to the main app. */
    fun finishOnboarding() {
        onboardingInProgress = false
    }

    suspend fun signOut() {
        // Unbind this device BEFORE the session goes away, or the delete has no
        // authorisation to run.
        PushRegistrar.onSignedOut()
        runCatching { supabase.client.auth.signOut() }
    }

    /** URLError-equivalent check: only transport failures are worth retrying. */
    private fun isTransport(e: Exception): Boolean {
        val name = e::class.simpleName.orEmpty()
        return e is java.io.IOException ||
            name.contains("Timeout", ignoreCase = true) ||
            name.contains("UnknownHost", ignoreCase = true) ||
            name.contains("Connect", ignoreCase = true)
    }

    private companion object {
        /**
         * Hard ceiling on any auth network call so the UI can never hang on an
         * indefinite spinner. The Ktor-level timeouts are the primary defence;
         * this is a second layer.
         */
        const val AUTH_TIMEOUT_MS = 25_000L
        const val GUEST_TIMEOUT_MS = 10_000L
    }
}
