package com.clubfuoco.app.features.inviteclaim

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.models.FriendUser
import com.clubfuoco.app.models.InviteDetail
import com.clubfuoco.app.models.InviteGuest
import com.clubfuoco.app.models.InviteLookup
import com.clubfuoco.app.models.InviteSlot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * What went wrong, as a case rather than a sentence.
 *
 * The view model holds no copy: it has no locale, and the app's language is a
 * user setting that can change under it. The screen maps these to strings.
 */
enum class InviteError { LOAD, CLAIM, CHECKOUT, NEEDS_ACCOUNT, ATTACH }

/**
 * The promoter-invite claim. Port of the logic half of `InviteClaimView`.
 *
 * Everything here is written to be safe to re-run: the claim endpoint is the
 * only call that creates anything, and re-opening an already-claimed invite goes
 * straight to the ticket instead of offering the form again.
 */
class InviteClaimViewModel : ViewModel() {

    // ── Screen state ─────────────────────────────────────────────────────────

    var loading by mutableStateOf(true)
        private set
    var error by mutableStateOf<InviteError?>(null)
    var detail by mutableStateOf<InviteDetail?>(null)
        private set
    var guests by mutableStateOf<List<InviteGuest>>(emptyList())
        private set

    /** The name that goes on the door list. Pre-filled from the profile. */
    var name by mutableStateOf("")

    /** One entry per EXTRA spot on the claim form, before anything is sent. */
    var slots by mutableStateOf<List<InviteSlot>>(emptyList())
        private set

    var submitting by mutableStateOf(false)
        private set
    var claimedGuestId by mutableStateOf<String?>(null)
        private set

    // Reduced signup, run AFTER the claim.
    var attaching by mutableStateOf(false)
        private set
    var attached by mutableStateOf(false)
        private set
    var attachFailed by mutableStateOf(false)
        private set

    // Paid nights.
    var saved by mutableStateOf(false)
        private set
    var savingEvent by mutableStateOf(false)
        private set
    /** Set when checkout is ready to open in the browser. */
    var checkoutUrl by mutableStateOf<String?>(null)

    // Post-claim party management (on the ticket).
    var partyPlusOnes by mutableStateOf(0)
        private set
    var invitedList by mutableStateOf<List<InvitedFriendsStore.Entry>>(emptyList())
        private set
    var partyBusy by mutableStateOf(false)
        private set

    private var partyLoaded = false
    private var pollJob: Job? = null
    private val json = Json { encodeDefaults = true }

    private lateinit var token: String
    private lateinit var api: ApiClient

    // ── Wire payloads ────────────────────────────────────────────────────────

    @Serializable
    private data class ClaimBody(
        @kotlinx.serialization.SerialName("full_name") val fullName: String,
        @kotlinx.serialization.SerialName("plus_ones") val plusOnes: Int,
    )

    @Serializable
    private data class PlusOnesBody(
        @kotlinx.serialization.SerialName("plus_ones") val plusOnes: Int,
    )

    @Serializable
    private data class InviteFriendsBody(
        @kotlinx.serialization.SerialName("user_ids") val userIds: List<String>,
    )

    @Serializable
    private data class ClaimedGuest(val id: String)

    @Serializable
    private data class ClaimResponse(val guest: ClaimedGuest)

    @Serializable
    private data class CheckoutResponse(
        val url: String? = null,
        val alreadyPaid: Boolean? = null,
        val guestId: String? = null,
    )

    @Serializable
    private data class SavedResponse(val saved: Boolean = false)

    @Serializable
    private data class AttachResponse(val attached: Boolean = false)

    @Serializable
    private data class PatchedGuest(
        @kotlinx.serialization.SerialName("plusOnes") val plusOnes: Int = 0,
    )

    @Serializable
    private data class PatchResponse(val guest: PatchedGuest)

    @Serializable
    private data class SentResponse(val sent: Int = 0)

    // ── Derived ──────────────────────────────────────────────────────────────

    /** Extra spots left OPEN on the form — these become anonymous plus-ones. */
    val openSpots: Int get() = slots.count { it is InviteSlot.Open }

    /** Friends already on a slot, hidden from the picker. */
    val assignedFriendIds: Set<String>
        get() = slots.filterIsInstance<InviteSlot.Friend>().map { it.friend.id }.toSet()

    /** Everyone who has actually claimed a spot — i.e. is going. */
    val claimedUserIds: Set<String>
        get() = guests.mapNotNull { it.claimedByUser?.lowercase() }.toSet()

    /** My own row, for my plus-one count and check-in state. */
    fun myGuest(guestId: String): InviteGuest? =
        guests.firstOrNull { it.id.equals(guestId, ignoreCase = true) }

    /** The promoter's per-guest cap: how many extra people I may bring. */
    val slotLimit: Int get() = detail?.night?.maxPlusOnes ?: 0

    /** Slots I have filled — named friends plus open spots. */
    val usedSlots: Int get() = invitedList.size + partyPlusOnes

    /** Room for one more, bounded by the promoter cap AND live capacity. */
    val canAddSlot: Boolean get() = usedSlots < slotLimit && partyPlusOnes < maxAllowedPlusOnes

    /**
     * Ceiling on open spots: the night's per-guest cap, or what is actually left
     * of the allocation after everyone else's heads and my own — whichever bites
     * first. Without the second term the form would happily promise spots the
     * allocation cannot cover, and the door would be the one to find out.
     */
    val maxAllowedPlusOnes: Int
        get() {
            val cap = detail?.night?.maxPlusOnes ?: 20
            val mine = claimedGuestId?.lowercase()
            val others = guests
                .filterNot { it.id.lowercase() == mine }
                .sumOf { 1 + it.plusOnes }
            val spots = detail?.spots ?: Int.MAX_VALUE
            return maxOf(0, minOf(cap, spots - others - 1))
        }

    /** Everyone already in my party or already going — hidden from the picker. */
    val excludedForInvite: Set<String>
        get() = invitedList.map { it.id }.toSet() + claimedUserIds

    val inviteUrl: String get() = "$BASE_URL/i/$token"

    // ── Loading ──────────────────────────────────────────────────────────────

    fun configure(
        token: String,
        api: ApiClient,
        profileName: String?,
        preclaimedGuestId: String?,
        preclaimedName: String?,
    ) {
        if (this::token.isInitialized) return
        this.token = token
        this.api = api

        viewModelScope.launch {
            val lookup = runCatching {
                withContext(Dispatchers.IO) {
                    api.get("/api/promoter-invites/$token", InviteLookup.serializer())
                }
            }.getOrNull()

            if (lookup == null) {
                error = InviteError.LOAD
                loading = false
                return@launch
            }

            detail = lookup.allocation
            guests = lookup.guests

            // Re-opening an invite that is already mine — skip the form.
            if (preclaimedGuestId != null) {
                claimedGuestId = preclaimedGuestId
                if (!preclaimedName.isNullOrEmpty()) name = preclaimedName
            } else if (!profileName.isNullOrEmpty()) {
                name = profileName
            }
            loading = false
        }
    }

    private suspend fun refreshRoster() {
        val lookup = runCatching {
            withContext(Dispatchers.IO) {
                api.get("/api/promoter-invites/$token", InviteLookup.serializer())
            }
        }.getOrNull() ?: return
        guests = lookup.guests
    }

    // ── The form ─────────────────────────────────────────────────────────────

    fun addOpenSlot() {
        slots = slots + InviteSlot.Open(UUID.randomUUID().toString())
    }

    fun assignToSlot(key: String, friend: FriendUser) {
        slots = slots.map { if (it.key == key) InviteSlot.Friend(friend) else it }
    }

    fun removeSlot(key: String) {
        slots = slots.filterNot { it.key == key }
    }

    /**
     * Join a free list.
     *
     * `claimed_by_user` is deliberately NOT sent: the server derives it from the
     * Bearer token and ignores any id in the body, which is what stops one
     * person claiming a spot in another's name.
     */
    fun submit(context: Context, onClaimed: () -> Unit) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        submitting = true
        error = null

        viewModelScope.launch {
            val response = runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/promoter-invites/$token/claim",
                        ClaimResponse.serializer(),
                        json.encodeToString(
                            ClaimBody.serializer(),
                            ClaimBody(trimmed, openSpots),
                        ),
                    )
                }
            }.getOrNull()

            if (response == null) {
                error = InviteError.CLAIM
                submitting = false
                return@launch
            }

            claimedGuestId = response.guest.id

            // Friend slots become targeted invites; they claim their own rows.
            val friends = slots.filterIsInstance<InviteSlot.Friend>().map { it.friend }
            if (friends.isNotEmpty()) {
                InvitedFriendsStore.save(context, token, friends)
                runCatching {
                    withContext(Dispatchers.IO) {
                        api.post(
                            "/api/promoter-invites/$token/invite-friends",
                            SentResponse.serializer(),
                            json.encodeToString(
                                InviteFriendsBody.serializer(),
                                InviteFriendsBody(friends.map { it.id.lowercase() }),
                            ),
                        )
                    }
                }
            }

            refreshRoster()

            // Pin the RESOLVED night so the geofence stays attached to this
            // occurrence — a series token re-resolves weekly and would otherwise
            // drag the fence onto the wrong date.
            detail?.night?.let { night ->
                InviteClaimsStore.add(
                    context = context,
                    token = token,
                    guestId = response.guest.id,
                    nightDate = night.nightDate,
                    lat = night.venueLat,
                    lng = night.venueLng,
                    openTime = night.openTime,
                    autoCheckin = night.autoCheckin ?: true,
                )
            }

            submitting = false
            onClaimed()
        }
    }

    /**
     * Open Stripe Checkout. The spot is held while they are on Stripe's page and
     * released if they never finish — the checkout route owns that.
     */
    fun startCheckout() {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        submitting = true
        error = null

        viewModelScope.launch {
            val response = runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/promoter-invites/$token/checkout",
                        CheckoutResponse.serializer(),
                        json.encodeToString(
                            ClaimBody.serializer(),
                            ClaimBody(trimmed, openSpots),
                        ),
                    )
                }
            }.getOrNull()

            submitting = false

            if (response == null) {
                error = InviteError.CHECKOUT
                return@launch
            }
            // Already bought on another device — show the ticket rather than
            // charging a second time.
            if (response.alreadyPaid == true && response.guestId != null) {
                claimedGuestId = response.guestId
                return@launch
            }
            val url = response.url
            if (url.isNullOrEmpty()) {
                error = InviteError.CHECKOUT
                return@launch
            }
            checkoutUrl = url
        }
    }

    /**
     * Bookmark it. Holds nothing and grants nothing — the copy on screen says so,
     * because a guest who thinks a save is a spot turns up to a full door.
     */
    fun toggleSave() {
        savingEvent = true
        viewModelScope.launch {
            val response = runCatching {
                withContext(Dispatchers.IO) {
                    if (saved) {
                        api.delete("/api/promoter-invites/$token/save", SavedResponse.serializer())
                    } else {
                        api.post("/api/promoter-invites/$token/save", SavedResponse.serializer())
                    }
                }
            }.getOrNull()

            // Needs an account — there is nowhere to put a bookmark for someone
            // who does not exist yet.
            if (response == null) error = InviteError.NEEDS_ACCOUNT else saved = response.saved
            savingEvent = false
        }
    }

    // ── The ticket ───────────────────────────────────────────────────────────

    /**
     * Start the ticket: settle a just-paid spot, load the party, then poll
     * gently so acceptances and the roster stay live without a pull-to-refresh.
     */
    fun startTicket(context: Context, guestId: String) {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            // Straight back from Stripe the webhook usually beats the redirect,
            // but when it does not the ticket would render a QR that 402s at the
            // door. Ask Stripe directly rather than leaving someone holding a
            // receipt and no way in. Silent and cheap: a no-op for a free or
            // already-paid spot, and a failure changes nothing on screen.
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/promoter-invites/guest/$guestId/verify-payment",
                        SavedResponse.serializer(),
                    )
                }
            }
            refreshRoster()

            if (!partyLoaded) {
                partyPlusOnes = myGuest(guestId)?.plusOnes ?: 0
                invitedList = InvitedFriendsStore.load(context, token)
                partyLoaded = true
            }

            while (isActive) {
                delay(POLL_MS)
                if (!isActive) break
                refreshRoster()
            }
        }
    }

    fun stopTicket() {
        pollJob?.cancel()
        pollJob = null
    }

    /** Bind an already-claimed spot to the account that just signed in. */
    fun attachSpot(guestId: String) {
        attaching = true
        attachFailed = false
        viewModelScope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/promoter-invites/guest/$guestId/attach",
                        AttachResponse.serializer(),
                    )
                }
            }.isSuccess
            // They ARE signed in by this point — only the binding failed. Say so
            // plainly rather than implying the spot is gone, because it is not:
            // the QR above still opens the door either way.
            if (ok) attached = true else attachFailed = true
            attaching = false
        }
    }

    fun changePlusOnes(value: Int, guestId: String) {
        val clamped = maxOf(0, minOf(value, maxAllowedPlusOnes))
        partyPlusOnes = clamped
        partyBusy = true
        viewModelScope.launch {
            val response = runCatching {
                withContext(Dispatchers.IO) {
                    api.patch(
                        "/api/promoter-invites/guest/$guestId",
                        PatchResponse.serializer(),
                        json.encodeToString(
                            PlusOnesBody.serializer(),
                            PlusOnesBody(clamped),
                        ),
                    )
                }
            }.getOrNull()

            if (response != null) {
                partyPlusOnes = response.guest.plusOnes
                refreshRoster()
            } else {
                // Revert to what the server last told us, so the row never shows
                // a spot that was refused.
                partyPlusOnes = myGuest(guestId)?.plusOnes ?: partyPlusOnes
            }
            partyBusy = false
        }
    }

    /**
     * Fill one OPEN slot with a specific friend: the slot flips from anonymous
     * to that person, so the party total never grows past the cap.
     */
    fun assignFriendFromTicket(context: Context, friend: FriendUser, guestId: String) {
        if (partyPlusOnes > 0) changePlusOnes(partyPlusOnes - 1, guestId)
        inviteFriend(context, friend)
    }

    fun inviteFriend(context: Context, friend: FriendUser) {
        val label = friend.fullName.orEmpty()
        InvitedFriendsStore.add(context, token, friend.id, label)
        if (invitedList.none { it.id == friend.id }) {
            invitedList = invitedList + InvitedFriendsStore.Entry(friend.id, label)
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.post(
                        "/api/promoter-invites/$token/invite-friends",
                        SentResponse.serializer(),
                        json.encodeToString(
                            InviteFriendsBody.serializer(),
                            InviteFriendsBody(listOf(friend.id.lowercase())),
                        ),
                    )
                }
            }
            refreshRoster()
        }
    }

    fun removeInvited(context: Context, id: String) {
        InvitedFriendsStore.remove(context, token, id)
        invitedList = invitedList.filterNot { it.id == id }
    }

    override fun onCleared() {
        pollJob?.cancel()
        super.onCleared()
    }

    private companion object {
        /**
         * The BRAND domain, not the API host: this string is shared with other
         * people, and it has to be the link that opens the app for them.
         */
        const val BASE_URL = "https://clubfuoco.com"
        const val POLL_MS = 12_000L
    }
}
