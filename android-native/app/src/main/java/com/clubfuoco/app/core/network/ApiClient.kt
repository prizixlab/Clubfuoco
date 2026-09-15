package com.clubfuoco.app.core.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.call.body
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Supplies a valid Supabase access token for the `Authorization: Bearer`
 * header. Implemented by SupabaseService (which refreshes an expired session
 * before returning). Mirrors `getAuthHeader()` in src/lib/api.ts and the
 * `AuthTokenProvider` protocol in the iOS app.
 */
interface AuthTokenProvider {
    /** Current access token, refreshed if expired. null when signed out. */
    suspend fun accessToken(): String?

    /** Force a session refresh (after an unexpected 401). Returns the new token. */
    suspend fun refreshSession(): String?
}

/**
 * Every API route responds `{ "data": T | null, "error": string | null }`
 * (ok()/err() in src/lib/utils.ts).
 */
@Serializable
data class ApiEnvelope<T>(val data: T? = null, val error: String? = null)

sealed class ApiException(message: String) : Exception(message) {
    /** Non-2xx with a server-supplied message (the envelope's `error`). */
    class Http(val status: Int, override val message: String) :
        ApiException("$message (HTTP $status)")

    /** A 401 that survived one token refresh + retry. */
    data object Unauthorized : ApiException("Unauthorized") {
        private fun readResolve(): Any = Unauthorized
    }

    /** 2xx but the envelope had no data and no error. */
    data object EmptyData : ApiException("Empty response") {
        private fun readResolve(): Any = EmptyData
    }

    class Network(cause: Throwable) : ApiException(cause.message ?: "Network error")
}

/**
 * Typed client for the Vercel REST API. Counterpart of `apiFetch()` in
 * src/lib/api.ts and `APIClient.swift`: prefixes the production host and
 * attaches the Supabase session as a Bearer token on every request.
 */
class ApiClient(
    private val tokenProvider: AuthTokenProvider,
    private val baseUrl: String = DEFAULT_BASE_URL,
) {
    /**
     * Snake_case on the wire, camelCase in Kotlin — the same bridge
     * `convertFromSnakeCase` provides on iOS. kotlinx.serialization has no
     * global strategy, so models carry @SerialName where the two differ;
     * `namingStrategy` handles the rest.
     */
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val client = HttpClient(OkHttp) {
        expectSuccess = false
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) {
            // Hard caps so a stalled connection surfaces as an error in seconds
            // instead of hanging the UI — the same reasoning as the iOS client,
            // where an unreachable edge on a review network was the trigger.
            requestTimeoutMillis = 20_000
            connectTimeoutMillis = 20_000
            socketTimeoutMillis = 30_000
        }
    }

    suspend fun <T> get(
        path: String,
        serializer: KSerializer<T>,
        query: Map<String, String> = emptyMap(),
    ): T = send(HttpMethod.Get, path, serializer, query, null)

    suspend fun <T> post(
        path: String,
        serializer: KSerializer<T>,
        body: String? = null,
    ): T = send(HttpMethod.Post, path, serializer, emptyMap(), body)

    suspend fun <T> patch(
        path: String,
        serializer: KSerializer<T>,
        body: String,
    ): T = send(HttpMethod.Patch, path, serializer, emptyMap(), body)

    suspend fun <T> delete(
        path: String,
        serializer: KSerializer<T>,
        body: String? = null,
    ): T = send(HttpMethod.Delete, path, serializer, emptyMap(), body)

    /** Raw (non-envelope) GET — used for binary payloads like wallet passes. */
    suspend fun rawBytes(path: String): ByteArray {
        val token = tokenProvider.accessToken()
        val response = perform(HttpMethod.Get, path, emptyMap(), null, token)
        if (response.status.value !in 200..299) {
            throw ApiException.Http(response.status.value, response.status.description)
        }
        return response.body<ByteArray>()
    }

    private suspend fun <T> send(
        method: HttpMethod,
        path: String,
        serializer: KSerializer<T>,
        query: Map<String, String>,
        body: String?,
    ): T {
        val token = tokenProvider.accessToken()
        val response = perform(method, path, query, body, token)

        // One refresh + retry on 401, then give up — the same contract the web
        // client gets from supabase-js's autoRefreshToken.
        if (response.status.value == 401) {
            val fresh = tokenProvider.refreshSession()
            if (fresh != null && fresh != token) {
                val retry = perform(method, path, query, body, fresh)
                if (retry.status.value == 401) throw ApiException.Unauthorized
                return decodeEnvelope(retry.bodyAsText(), retry.status.value, serializer)
            }
            throw ApiException.Unauthorized
        }

        return decodeEnvelope(response.bodyAsText(), response.status.value, serializer)
    }

    private suspend fun perform(
        method: HttpMethod,
        path: String,
        query: Map<String, String>,
        body: String?,
        token: String?,
    ): HttpResponse = try {
        client.request(baseUrl + path) {
            this.method = method
            header("Accept", "application/json")
            token?.let { header("Authorization", "Bearer $it") }
            query.forEach { (k, v) -> this.url.parameters.append(k, v) }
            if (body != null) {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
        }
    } catch (e: Exception) {
        throw ApiException.Network(e)
    }

    private fun <T> decodeEnvelope(text: String, status: Int, serializer: KSerializer<T>): T {
        val envelope = try {
            json.decodeFromString(ApiEnvelope.serializer(serializer), text)
        } catch (e: Exception) {
            // Non-envelope body (e.g. a middleware redirect page) — surface the
            // status rather than a decode error, which says nothing useful.
            if (status !in 200..299) throw ApiException.Http(status, "HTTP $status")
            throw ApiException.Network(e)
        }

        if (status !in 200..299) {
            throw ApiException.Http(status, envelope.error ?: "HTTP $status")
        }
        envelope.error?.let { throw ApiException.Http(status, it) }
        return envelope.data ?: throw ApiException.EmptyData
    }

    companion object {
        /**
         * The API is served from the Vercel deployment host, NOT the brand
         * domain — same as the iOS client. Note this couples shipped builds to
         * the deployment hostname; see the review notes.
         */
        const val DEFAULT_BASE_URL = "https://clubfuoco.vercel.app"
    }
}
