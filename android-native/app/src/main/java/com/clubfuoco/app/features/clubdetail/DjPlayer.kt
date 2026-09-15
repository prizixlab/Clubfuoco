package com.clubfuoco.app.features.clubdetail

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.Locale

/**
 * The SoundCloud preview engine, and our own controls on top of it.
 *
 * SoundCloud's player is a locked iframe we cannot restyle, but its JS Widget
 * API lets us drive a HIDDEN widget — play, pause, seek, plus progress and title
 * events — and build the gold player around it.
 *
 * The web view lives in this singleton rather than in the DJ screen, so it
 * OUTLIVES that screen: the first open pays for the web view, the iframe and
 * SoundCloud's api.js, and every open after that is a profile swap on a warm
 * widget rather than a cold boot.
 *
 * Leaving the screen PAUSES rather than tears down. There is no app-wide mini
 * player, so audio must never outlive the screen the user can see — but the
 * machinery behind it should.
 *
 * Port of `DJPlayer.swift`.
 */
@SuppressLint("StaticFieldLeak")
object DjPlayer {

    // ── Now playing, observed by the controls ────────────────────────────────

    var raArtistId by mutableStateOf<String?>(null)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var isLoading by mutableStateOf(false)
        private set
    /** 0…1 of the current track. */
    var progress by mutableDoubleStateOf(0.0)
        private set
    var positionMs by mutableDoubleStateOf(0.0)
        private set
    var durationMs by mutableDoubleStateOf(0.0)
        private set
    var trackTitle by mutableStateOf("")
        private set

    /**
     * The widget answered with nothing playable — a dead profile, no public
     * tracks, or no network. Roughly one handle in ten is like this, so it is a
     * state the card states plainly rather than a transient it spins on.
     */
    var unavailable by mutableStateOf(false)
        private set

    // ── Machinery ────────────────────────────────────────────────────────────

    private var webView: WebView? = null
    private var ready = false
    private var loadedProfile: String? = null
    private var watchdog: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main.immediate)
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Longest a profile may sit loading before it is called unavailable. The
     * widget reports a bad profile itself within about half a second and gives
     * up on metadata by ~3.5s, so this only covers the page never coming up at
     * all — no network, or api.js blocked.
     */
    private const val LOAD_TIMEOUT_MS = 10_000L

    /**
     * Point the player at a DJ. Always loads that profile, taking over whatever
     * was playing; only starts playing when [autoplay].
     */
    fun open(context: Context, raArtistId: String, soundcloud: String?, autoplay: Boolean) {
        this.raArtistId = raArtistId

        val profile = canonicalSoundCloud(soundcloud)
        if (profile == null) {
            clear()
            unavailable = true
            return
        }

        if (profile == loadedProfile && webView != null) {
            // Same DJ, warm widget: nothing to reload.
            if (autoplay && !unavailable) play()
            return
        }

        trackTitle = ""
        progress = 0.0
        positionMs = 0.0
        durationMs = 0.0
        isPlaying = false
        isLoading = true
        unavailable = false
        loadedProfile = profile
        startWatchdog()

        val web = webView
        when {
            web == null -> build(context, profile, autoplay)
            ready -> eval("scLoad(${jsString(profile)}, $autoplay)")
            // Web view exists but has not reported READY yet — swap the source
            // and let READY fire against the new page.
            else -> web.loadDataWithBaseURL(
                BASE_URL, html(profile, autoplay), "text/html", "utf-8", null,
            )
        }
    }

    fun toggle() = if (isPlaying) pause() else play()

    fun play() {
        if (unavailable) return
        isLoading = true
        startWatchdog()
        eval("scPlay()")
    }

    fun pause() = eval("scPause()")

    fun seek(fraction: Double) {
        if (unavailable || durationMs <= 0) return
        val f = fraction.coerceIn(0.0, 1.0)
        progress = f
        positionMs = f * durationMs
        eval("scSeek($f)")
    }

    /**
     * Leaving the DJ screen: stop the audio, keep the widget warm.
     */
    fun suspend() {
        watchdog?.cancel()
        watchdog = null
        eval("scPause()")
        isPlaying = false
        isLoading = false
    }

    /** Stop and tear the player down, freeing the web view. */
    fun close() {
        eval("scPause()")
        webView?.let { web ->
            web.removeJavascriptInterface(BRIDGE)
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        webView = null
        clear()
    }

    private fun clear() {
        raArtistId = null
        ready = false
        loadedProfile = null
        isPlaying = false
        isLoading = false
        unavailable = false
        progress = 0.0
        positionMs = 0.0
        durationMs = 0.0
        trackTitle = ""
        watchdog?.cancel()
        watchdog = null
    }

    private fun startWatchdog() {
        watchdog?.cancel()
        watchdog = scope.launch {
            delay(LOAD_TIMEOUT_MS)
            if (isLoading) markUnavailable()
        }
    }

    private fun markUnavailable() {
        watchdog?.cancel()
        watchdog = null
        isLoading = false
        isPlaying = false
        // Only a profile that never produced a playable track is "unavailable";
        // one that already gave us a title is simply between events.
        if (trackTitle.isEmpty() || durationMs <= 0) unavailable = true
    }

    // ── Web view ─────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun build(context: Context, profile: String, autoplay: Boolean) {
        // Application context on the web view itself: this outlives any one
        // screen by design, and holding an Activity here would leak it.
        val web = WebView(context.applicationContext)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The tap on our play button IS the user gesture — requiring a
            // second one inside the iframe would make the button do nothing.
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        web.addJavascriptInterface(Bridge, BRIDGE)
        attachOffScreen(context, web)
        webView = web
        web.loadDataWithBaseURL(BASE_URL, html(profile, autoplay), "text/html", "utf-8", null)
    }

    /**
     * Put the web view in the window, off screen.
     *
     * A WebView that is never attached can have its work throttled, which is
     * enough to stall the widget's bootstrap and lose its first metadata reply.
     * It is given a real player-sized box for the same reason — collapsing it to
     * a pixel throttles it just as hard. iOS does exactly this with the key
     * window; the note there was learned the hard way.
     *
     * Not fatal if there is no Activity to hand: the player simply runs
     * detached and may be slower to report in.
     */
    private fun attachOffScreen(context: Context, web: WebView) {
        val activity = generateSequence(context) { (it as? ContextWrapper)?.baseContext }
            .filterIsInstance<Activity>()
            .firstOrNull() ?: return
        val root = activity.window?.decorView as? ViewGroup ?: return

        val density = activity.resources.displayMetrics.density
        web.layoutParams = ViewGroup.LayoutParams(
            (320 * density).toInt(),
            (166 * density).toInt(),
        )
        // Off screen rather than GONE: a hidden view can have its media
        // suspended outright.
        web.translationY = -4000f
        web.alpha = 0.01f
        web.isEnabled = false
        runCatching { root.addView(web) }
    }

    private fun eval(js: String) {
        val web = webView ?: return
        // evaluateJavascript is main-thread only, and events can arrive on the
        // bridge's own thread.
        scope.launch { web.evaluateJavascript(js, null) }
    }

    private const val BRIDGE = "AndroidDj"
    private const val BASE_URL = "https://w.soundcloud.com"

    /** Receives the widget's events. Called on a WebView JS thread, not main. */
    private object Bridge {
        @JavascriptInterface
        fun onEvent(raw: String) {
            scope.launch { handle(raw) }
        }
    }

    private fun handle(raw: String) {
        val body = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return
        val type = body["type"]?.jsonPrimitive?.content ?: return
        val ms = body["ms"]?.jsonPrimitive?.doubleOrNull
        val rel = body["rel"]?.jsonPrimitive?.doubleOrNull

        when (type) {
            "ready" -> {
                ready = true
                if (!isPlaying) isLoading = false
            }
            "loaded" -> isLoading = false
            "play" -> {
                isPlaying = true
                isLoading = false
                unavailable = false
            }
            "pause" -> {
                isPlaying = false
                isLoading = false
            }
            "finish" -> {
                isPlaying = false
                progress = 0.0
                positionMs = 0.0
            }
            "title" -> body["title"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }?.let {
                trackTitle = it
                unavailable = false
            }
            "nometa", "error" -> markUnavailable()
            "duration" -> ms?.let { durationMs = it }
            "progress" -> {
                rel?.let { progress = it.coerceIn(0.0, 1.0) }
                ms?.let { positionMs = it }
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * The catalogue stores "https://www.soundcloud.com/kink"; the widget
     * resolver wants the canonical "https://soundcloud.com/kink". A bare handle
     * is accepted too, since that is what a hand-entered value looks like.
     *
     * Anything that is not a soundcloud.com profile or track is REJECTED rather
     * than handed to the widget. A few rows hold a URL pasted into itself
     * ("soundcloud.com/https://raul-mezcolanza"), which parses happily and would
     * render a player that can never load.
     */
    fun canonicalSoundCloud(raw: String?): String? {
        var s = raw?.trim().orEmpty()
        if (s.isEmpty()) return null

        if (!s.lowercase().startsWith("http")) {
            if (s.contains("/") || s.contains(":")) return null
            s = "https://soundcloud.com/" + s.replace("@", "")
        }

        val uri = runCatching { Uri.parse(s) }.getOrNull() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (host != "soundcloud.com" && !host.endsWith(".soundcloud.com")) return null

        // A profile is one path segment, a track two, a set three
        // ("/kink/sets/live"). Deeper than that, or a segment carrying a scheme,
        // means the value is malformed rather than a page SoundCloud can serve.
        val segments = uri.path.orEmpty().split("/").filter { it.isNotEmpty() }
        if (segments.size !in 1..3) return null
        if (segments.any { it.contains(":") }) return null

        return "https://soundcloud.com/" + segments.joinToString("/")
    }

    fun timeLabel(ms: Double): String {
        val total = (ms / 1000).toInt().coerceAtLeast(0)
        return String.format(Locale.US, "%d:%02d", total / 60, total % 60)
    }

    private fun jsString(raw: String): String =
        "'" + raw.replace("\\", "\\\\").replace("'", "\\'") + "'"

    private fun html(profile: String, autoplay: Boolean): String {
        val encoded = Uri.encode(profile)
        val src = "https://w.soundcloud.com/player/?url=$encoded" +
            "&auto_play=$autoplay&visual=false&hide_related=true&show_comments=false" +
            "&show_user=true&show_teaser=false&sharing=false&buying=false&download=false" +
            "&single_active=false&color=%23C09950"

        // The metadata dance is the fiddly part and the comments are load-bearing
        // — see the iOS original, which learned it the hard way.
        return """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}iframe{width:100%;height:100%;border:0}</style>
        </head><body>
        <iframe id="w" allow="autoplay" src="$src"></iframe>
        <script src="https://w.soundcloud.com/player/api.js"></script>
        <script>
        var w = SC.Widget(document.getElementById('w'));
        function post(m){ try{ $BRIDGE.onEvent(JSON.stringify(m)); }catch(e){} }

        // A profile URL resolves to that artist's tracks, so the title and
        // duration have to be ASKED for. The widget only answers once its own
        // bootstrap has finished, which is often after READY fires — a single
        // ask on READY is why a player could sit on "Loading…" forever with a
        // live 0:00 / 0:00 under it.
        //
        // So ask repeatedly over a short window, then stop. A live profile
        // answers within ~100ms of READY; the later steps only cover a slow
        // bootstrap. Giving up at ~3.4s and saying so beats a longer wait,
        // because "no preview" is the honest answer by then.
        var haveTitle = false, haveDuration = false, gen = 0;
        var STEPS = [0, 300, 700, 1200, 2000, 3000];

        function meta(){
          w.getCurrentSound(function(s){
            if (s && s.title)    { haveTitle = true;    post({type:'title', title:s.title}); }
            if (s && s.duration) { haveDuration = true; post({type:'duration', ms:s.duration}); }
          });
          w.getDuration(function(d){
            if (d > 0) { haveDuration = true; post({type:'duration', ms:d}); }
          });
        }

        function done(){ return haveTitle && haveDuration; }

        // A new profile — or a track change inside one — invalidates what we
        // hold. `gen` retires the previous round's pending steps, so two loads
        // in quick succession cannot leave overlapping chains asking for the
        // metadata of a profile that is no longer on screen.
        function track(){
          haveTitle = false; haveDuration = false;
          var mine = ++gen;
          STEPS.forEach(function(delay, i){
            setTimeout(function(){
              if (mine !== gen || done()) return;
              try { meta(); } catch (e) {}
              if (i === STEPS.length - 1) {
                setTimeout(function(){
                  if (mine === gen && !done()) post({type:'nometa'});
                }, 400);
              }
            }, delay);
          });
        }

        w.bind(SC.Widget.Events.READY, function(){ post({type:'ready'}); track(); });
        w.bind(SC.Widget.Events.PLAY, function(){ post({type:'play'}); track(); });
        w.bind(SC.Widget.Events.PAUSE, function(){ post({type:'pause'}); });
        w.bind(SC.Widget.Events.FINISH, function(){ post({type:'finish'}); });
        w.bind(SC.Widget.Events.ERROR, function(){ post({type:'error'}); });
        w.bind(SC.Widget.Events.PLAY_PROGRESS, function(e){ post({type:'progress',ms:e.currentPosition,rel:e.relativePosition}); });

        function scPlay(){ w.play(); }
        function scPause(){ w.pause(); }
        function scSeek(f){ w.getDuration(function(d){ w.seekTo(Math.floor(d*f)); }); }
        function scLoad(url, ap){ w.load(url, { auto_play: ap, visual:false, hide_related:true,
            show_comments:false, show_user:true, sharing:false, buying:false, download:false,
            single_active:false, color:'#C09950',
            callback: function(){ post({type:'loaded'}); track(); if(ap){ w.play(); } } }); }
        </script></body></html>
        """.trimIndent()
    }
}
