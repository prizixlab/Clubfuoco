package com.clubfuoco.app.app

import android.content.Context
import com.clubfuoco.app.core.cache.FeedCache
import com.clubfuoco.app.core.network.ApiClient
import com.clubfuoco.app.core.notifications.PushRegistrar
import com.clubfuoco.app.core.supabase.Queries
import com.clubfuoco.app.core.supabase.SupabaseService
import com.clubfuoco.app.stores.AuthStore
import com.clubfuoco.app.stores.LocaleStore
import com.clubfuoco.app.stores.PlanStore
import com.clubfuoco.app.stores.ThemeStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

/**
 * Composition root. Builds the service graph once and hands the pieces down the
 * Compose tree. Port of ios-native's `AppEnvironment`, which in turn mirrors the
 * provider stack in the web app's root layout.
 *
 * Deliberately plain construction rather than a DI framework: the graph is six
 * objects deep and the iOS app proves it does not need more.
 */
class AppEnvironment(context: Context) {
    /** Lives as long as the process — the auth subscription must never be cancelled. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val supabase = SupabaseService(context)
    val api = ApiClient(tokenProvider = supabase)
    val queries = Queries(supabase)
    val authStore = AuthStore(supabase, queries, scope)
    val planStore = PlanStore(context)
    val feedCache = FeedCache(context)
    val localeStore = LocaleStore(context)
    val themeStore = ThemeStore(context)

    init {
        // Remote push needs the Supabase client to store the APNs/FCM token
        // against the signed-in user.
        PushRegistrar.attach(supabase)
        authStore.start()
    }
}
