package com.clubfuoco.app.core.cache

import android.content.Context
import com.clubfuoco.app.features.explore.Shelf
import com.clubfuoco.app.models.Place
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Stale-while-revalidate snapshot of the explore feed. Persisted after each
 * successful load so a cold launch paints the last-known feed instantly and
 * refreshes in the background, rather than sitting on a skeleton.
 *
 * Venues change slowly, so a few-day-old snapshot is fine to show for the ~1s a
 * refresh takes; anything older is discarded.
 */
@Serializable
data class FeedSnapshot(
    val places: List<Place>,
    val shelves: List<Shelf>,
    val saved: List<String>,
    val planDate: String,
    val savedAt: Long,
)

class FeedCache(context: Context) {

    private val file = File(context.cacheDir, "explore-feed.json")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun load(): FeedSnapshot? = runCatching {
        if (!file.exists()) return null
        val snap = json.decodeFromString(FeedSnapshot.serializer(), file.readText())
        if (snap.places.isEmpty()) return null
        if (System.currentTimeMillis() - snap.savedAt > MAX_AGE_MS) return null
        snap
    }.getOrNull()

    fun save(snapshot: FeedSnapshot) {
        // Encode + write off the main thread so persisting the whole feed never
        // hitches the UI on the load that just finished.
        scope.launch {
            runCatching {
                file.writeText(json.encodeToString(FeedSnapshot.serializer(), snapshot))
            }
        }
    }

    private companion object {
        /** Beyond this the snapshot is too stale to flash before the refresh lands. */
        const val MAX_AGE_MS = 7L * 24 * 3600 * 1000
    }
}
