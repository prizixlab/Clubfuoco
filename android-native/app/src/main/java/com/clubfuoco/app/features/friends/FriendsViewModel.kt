package com.clubfuoco.app.features.friends

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.FriendSearchResult
import com.clubfuoco.app.models.FriendsData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

class FriendsViewModel : ViewModel() {

    var data by mutableStateOf(FriendsData())
        private set
    var results by mutableStateOf<List<FriendSearchResult>>(emptyList())
        private set

    private val json = Json { encodeDefaults = true }
    private var searchJob: Job? = null

    @Serializable
    private data class Ack(val ok: Boolean? = null, val id: String? = null)

    @Serializable
    private data class AddBody(val userId: String)

    @Serializable
    private data class RespondBody(val friendshipId: String, val accept: Boolean)

    @Serializable
    private data class RemoveBody(val friendshipId: String)

    fun load(api: ApiClient) {
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { api.get("/api/friends", FriendsData.serializer()) }
            }.onSuccess { data = it }
        }
    }

    /**
     * Debounced: the search endpoint is hit on every keystroke otherwise, and
     * the results of a stale query can land after a newer one.
     */
    fun search(query: String, api: ApiClient) {
        searchJob?.cancel()
        if (query.isBlank()) {
            results = emptyList()
            return
        }
        searchJob = viewModelScope.launch {
            delay(250)
            runCatching {
                withContext(Dispatchers.IO) {
                    api.get(
                        "/api/friends/search",
                        ListSerializer(FriendSearchResult.serializer()),
                        mapOf("q" to query.trim()),
                    )
                }
            }.onSuccess { results = it }
        }
    }

    fun add(userId: String, api: ApiClient) {
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/friends",
                        Ack.serializer(),
                        json.encodeToString(AddBody.serializer(), AddBody(userId)),
                    )
                }
            }
            load(api)
            // Reflect the new relation without re-typing the query.
            results = results.map {
                if (it.id == userId) it.copy(relation = "outgoing") else it
            }
        }
    }

    fun respond(friendshipId: String?, accept: Boolean, api: ApiClient) {
        val id = friendshipId ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/friends/respond",
                        Ack.serializer(),
                        json.encodeToString(RespondBody.serializer(), RespondBody(id, accept)),
                    )
                }
            }
            load(api)
        }
    }

    fun remove(friendshipId: String?, api: ApiClient) {
        val id = friendshipId ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.delete(
                        "/api/friends",
                        Ack.serializer(),
                        json.encodeToString(RemoveBody.serializer(), RemoveBody(id)),
                    )
                }
            }
            load(api)
        }
    }
}
