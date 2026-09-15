package com.clubfuoco.app.features.groups

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.GroupDetail
import com.clubfuoco.app.models.GroupListItem
import com.clubfuoco.app.models.GroupMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** The groups strip on Tickets. */
class GroupsListViewModel : ViewModel() {
    var groups by mutableStateOf<List<GroupListItem>>(emptyList())
        private set

    fun load(api: ApiClient) {
        viewModelScope.launch {
            groups = runCatching {
                withContext(Dispatchers.IO) {
                    api.get("/api/groups", ListSerializer(GroupListItem.serializer()))
                }
            }.getOrElse { emptyList() }
        }
    }

    /** Groups the user has been invited to but not yet answered. */
    val pendingInvites: List<GroupListItem>
        get() = groups.filter { it.status == "open" && it.myRsvp == "invited" }
}

/** One group: members, RSVP, chat. */
class GroupDetailViewModel : ViewModel() {

    var detail by mutableStateOf<GroupDetail?>(null)
        private set
    var messages by mutableStateOf<List<GroupMessage>>(emptyList())
        private set
    var busy by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)

    private val json = Json { encodeDefaults = true }

    @Serializable
    private data class Ack(val ok: Boolean? = null)

    @Serializable
    private data class RsvpBody(val rsvp: String)

    @Serializable
    private data class MessageBody(val body: String)

    fun load(groupId: String, api: ApiClient) {
        viewModelScope.launch {
            detail = runCatching {
                withContext(Dispatchers.IO) {
                    api.get("/api/groups/$groupId", GroupDetail.serializer())
                }
            }.getOrNull()
            loadMessages(groupId, api)
        }
    }

    fun loadMessages(groupId: String, api: ApiClient) {
        viewModelScope.launch {
            messages = runCatching {
                withContext(Dispatchers.IO) {
                    api.get(
                        "/api/groups/$groupId/messages",
                        ListSerializer(GroupMessage.serializer()),
                    )
                }
            }.getOrElse { emptyList() }
        }
    }

    /**
     * Answer the invite. Only the FREE path is wired: a group whose entry costs
     * money needs a confirmed PaymentIntent, and Google Pay is not configured —
     * the UI says so rather than failing silently.
     */
    fun respond(groupId: String, rsvp: String, api: ApiClient) {
        busy = true
        errorMessage = null
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/groups/$groupId/join",
                        Ack.serializer(),
                        json.encodeToString(RsvpBody.serializer(), RsvpBody(rsvp)),
                    )
                }
            }.onFailure { errorMessage = it.message }
            busy = false
            load(groupId, api)
        }
    }

    fun send(groupId: String, body: String, api: ApiClient) {
        val trimmed = body.trim()
        if (trimmed.isEmpty()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/groups/$groupId/messages",
                        Ack.serializer(),
                        json.encodeToString(MessageBody.serializer(), MessageBody(trimmed)),
                    )
                }
            }
            loadMessages(groupId, api)
        }
    }
}
