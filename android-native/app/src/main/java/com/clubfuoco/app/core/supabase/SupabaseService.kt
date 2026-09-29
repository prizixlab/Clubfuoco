package com.clubfuoco.app.core.supabase

import android.content.Context
import com.clubfuoco.app.core.network.AuthTokenProvider
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Single Supabase client for the whole app — auth (persisted session,
 * auto-refresh) plus the direct PostgREST path that mirrors
 * src/lib/supabase/queries.ts. Counterpart of `SupabaseService.swift` and
 * src/lib/supabase/client.ts.
 *
 * The two-data-path architecture is deliberate and carried over wholesale from
 * iOS: user-scoped reads go straight to PostgREST under RLS (because several
 * REST routes read with a cookie session a native Bearer request does not
 * have), while everything else goes through [com.clubfuoco.app.core.network.ApiClient].
 */
class SupabaseService(context: Context) : AuthTokenProvider {

    val client: SupabaseClient = createSupabaseClient(
        supabaseUrl = SUPABASE_URL,
        supabaseKey = ANON_KEY,
    ) {
        install(Auth) {
            // Deep link back into the app after hosted OAuth — matches the
            // manifest's com.clubfuoco.app://login-callback intent filter.
            scheme = "com.clubfuoco.app"
            host = "login-callback"
        }
        install(Postgrest)
        defaultSerializer = io.github.jan.supabase.serializer.KotlinXSerializer(
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
                coerceInputValues = true
            },
        )
    }

    /**
     * `auth.currentAccessTokenOrNull()` returns the live token, refreshing an
     * expired session first — the same guarantee `apiFetch()` gets from
     * supabase-js and `client.auth.session` gives on iOS.
     */
    override suspend fun accessToken(): String? =
        runCatching { client.auth.currentAccessTokenOrNull() }
            .onFailure { signOutIfSessionDead(it) }
            .getOrNull()

    override suspend fun refreshSession(): String? =
        runCatching {
            client.auth.refreshCurrentSession()
            client.auth.currentAccessTokenOrNull()
        }.onFailure { signOutIfSessionDead(it) }.getOrNull()

    /** The signed-in user's id, or null when there is no usable session. */
    suspend fun currentUserId(): String? =
        runCatching { client.auth.currentUserOrNull()?.id }
            .onFailure { signOutIfSessionDead(it) }
            .getOrNull()

    /**
     * Call a SECURITY DEFINER function that returns a bare boolean — used for
     * the `check_phone_exists` pre-flight, which has to bypass RLS without
     * exposing the phone column to anonymous reads.
     */
    suspend fun rpcBoolean(function: String, vararg params: Pair<String, String>): Boolean {
        val args = buildJsonObject { params.forEach { (k, v) -> put(k, v) } }
        return client.postgrest.rpc(function, args).decodeAs<Boolean>()
    }

    val sessionStatus get() = client.auth.sessionStatus

    /**
     * GoTrue explicitly rejected our refresh token (revoked, rotated away
     * mid-kill, or expired) — the stored session can never recover, so clear it
     * and let the session flow emit NotAuthenticated. Without this the app runs
     * a "zombie" signed-in UI: Tickets renders empty, favourites vanish, and
     * every write 401s with no hint that signing back in would fix it.
     *
     * Transient network errors are deliberately left alone; the session may
     * still be perfectly good.
     */
    private suspend fun signOutIfSessionDead(error: Throwable) {
        val message = error.message.orEmpty().lowercase()
        val dead = listOf(
            "refresh_token_not_found",
            "refresh token not found",
            "already used",
            "session_not_found",
            "session not found",
            "session_expired",
        ).any { it in message }
        if (dead) runCatching { client.auth.signOut() }
    }

    companion object {
        const val SUPABASE_URL = "https://nqviodkapzjdkbgknauo.supabase.co"

        // Anon key — public by design (the same value the web bundle ships).
        const val ANON_KEY =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdmlvZGthcHpqZGtiZ2tuYXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTE2MjIsImV4cCI6MjA5MzY4NzYyMn0.CygsWuRRUQY4e7OzX8VYlaaWfoQO6K9KWZP_StGEr18"
    }
}
