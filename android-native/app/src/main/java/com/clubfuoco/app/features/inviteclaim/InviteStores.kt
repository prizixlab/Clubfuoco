package com.clubfuoco.app.features.inviteclaim

import android.content.Context
import androidx.core.content.edit
import com.clubfuoco.app.models.FriendUser
import java.time.LocalDate
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val store = Json { ignoreUnknownKeys = true; encodeDefaults = true }

private fun prefs(context: Context) =
    context.getSharedPreferences("cf.invite", Context.MODE_PRIVATE)

// ── Friends I put on slots ───────────────────────────────────────────────────

/**
 * Local record of which friends I assigned to slots on a given invite token, so
 * the ticket can show their status: GOING once they appear in the roster,
 * INVITED until then.
 *
 * On-device on purpose — the server knows a targeted invite was sent, but not
 * that *I* was the one who spent a slot on it, and teaching it that would be a
 * schema change to show one word on one screen.
 *
 * Port of `InvitedFriendsStore`.
 */
object InvitedFriendsStore {

    @Serializable
    data class Entry(val id: String, val name: String)

    private fun key(token: String) = "invited_friends.$token"

    fun load(context: Context, token: String): List<Entry> {
        val raw = prefs(context).getString(key(token), null) ?: return emptyList()
        return runCatching {
            store.decodeFromString(ListSerializer(Entry.serializer()), raw)
        }.getOrElse { emptyList() }
    }

    fun save(context: Context, token: String, friends: List<FriendUser>) {
        write(context, token, friends.map { Entry(it.id, it.fullName.orEmpty()) })
    }

    /** Append one friend (deduped) — used when inviting from the ticket. */
    fun add(context: Context, token: String, id: String, name: String) {
        val current = load(context, token)
        if (current.any { it.id == id }) return
        write(context, token, current + Entry(id, name))
    }

    fun remove(context: Context, token: String, id: String) {
        write(context, token, load(context, token).filterNot { it.id == id })
    }

    private fun write(context: Context, token: String, entries: List<Entry>) {
        prefs(context).edit {
            putString(key(token), store.encodeToString(ListSerializer(Entry.serializer()), entries))
        }
    }
}

// ── Claimed invites (for the geofence + revisit) ─────────────────────────────

/**
 * Every spot I hold, pinned to the exact night it was claimed for.
 *
 * The pin is the point. A series token re-resolves weekly, so re-deriving the
 * night from the token later would silently move the geofence to NEXT week's
 * occurrence and stop the check-in firing on the night the person is actually
 * standing outside the venue. Storing the resolved date and coordinates also
 * means building geofences needs no network at all.
 *
 * Port of `InviteClaimsStore` (v3 of the iOS payload — same shape, so the two
 * stay comparable).
 */
object InviteClaimsStore {

    @Serializable
    data class Claim(
        val token: String,
        val guestId: String,
        /** yyyy-MM-dd of the claimed occurrence. */
        val nightDate: String,
        val lat: Double? = null,
        val lng: Double? = null,
        /** "HH:mm:ss" — the start of the geofence window. */
        val openTime: String? = null,
        /** Event-level: should this register a geofence at all? */
        val autoCheckin: Boolean = true,
        val claimedAt: Long = 0L,
    )

    private const val KEY = "invite_claims.v3"

    /** Live claims, pruning anything whose night is more than a day past. */
    fun all(context: Context): List<Claim> {
        val raw = prefs(context).getString(KEY, null) ?: return emptyList()
        val stored = runCatching {
            store.decodeFromString(ListSerializer(Claim.serializer()), raw)
        }.getOrElse { return emptyList() }

        val cutoff = LocalDate.now().minusDays(1)
        val live = stored.filter {
            val day = runCatching { LocalDate.parse(it.nightDate) }.getOrNull()
            day == null || !day.isBefore(cutoff)
        }
        if (live.size != stored.size) write(context, live)
        return live
    }

    fun add(
        context: Context,
        token: String,
        guestId: String,
        nightDate: String,
        lat: Double?,
        lng: Double?,
        openTime: String?,
        autoCheckin: Boolean,
    ) {
        val next = all(context).filterNot { it.guestId == guestId } + Claim(
            token = token,
            guestId = guestId,
            nightDate = nightDate,
            lat = lat,
            lng = lng,
            openTime = openTime,
            autoCheckin = autoCheckin,
            claimedAt = System.currentTimeMillis(),
        )
        write(context, next)
    }

    fun remove(context: Context, guestId: String) {
        write(context, all(context).filterNot { it.guestId == guestId })
    }

    private fun write(context: Context, claims: List<Claim>) {
        prefs(context).edit {
            putString(KEY, store.encodeToString(ListSerializer(Claim.serializer()), claims))
        }
    }
}
