import SwiftUI
import WebKit
import Observation

// App-level SoundCloud audio engine + our own gold UI.
//
// SoundCloud's player is a locked iframe, so we can't restyle it — but its JS
// Widget API lets us drive a HIDDEN widget (play/pause/seek + progress/title
// events) and build our own controls on top. The web view lives here in a
// singleton attached off-screen to the key window, so it OUTLIVES the DJ sheet:
// the first open pays for the web view, the iframe and SoundCloud's api.js, and
// every open after that reuses a warm widget and only swaps the profile.
//
// Closing the sheet pauses rather than tears down — there is no app-wide
// mini-bar, so audio must never outlive the sheet the user can see, but the
// machinery behind it should, or every DJ tap is a cold start again.
//
// No background/lock-screen playback (no UIBackgroundModes: audio) — audio runs
// only while the app is foregrounded, by design.

@MainActor
@Observable
final class DJPlayer: NSObject {
    static let shared = DJPlayer()

    // Now-playing state (observed by the controls).
    private(set) var dj: FeaturedDJ?
    private(set) var isPlaying = false
    private(set) var isLoading = false
    private(set) var progress: Double = 0        // 0…1 of the current track
    private(set) var positionMs: Double = 0
    private(set) var durationMs: Double = 0
    private(set) var trackTitle = ""
    /// The widget answered with nothing playable (dead profile, no public
    /// tracks, or no network). The controls say so instead of spinning forever.
    private(set) var unavailable = false

    var isActive: Bool { dj != nil }

    private var webView: WKWebView?
    private var ready = false
    private var loadedProfile: String?           // avoid reloading the same DJ
    private var watchdog: Task<Void, Never>?

    /// Longest we let a profile sit in "loading" before calling it unavailable.
    /// The widget reports a bad profile itself within ~0.5s and gives up on
    /// metadata by ~3.5s, so this only covers the case where the page never
    /// comes up at all (no network, api.js blocked) and nothing reports in.
    private static let loadTimeout: Duration = .seconds(10)

    private nonisolated override init() { super.init() }

    // MARK: - Control

    /// Point the player at a DJ. Always loads that DJ (taking over any current
    /// playback); only starts playing when `autoplay` is true.
    func open(_ dj: FeaturedDJ, autoplay: Bool) {
        self.dj = dj
        guard let profile = Self.canonicalSoundCloud(dj.soundcloud)?.absoluteString else {
            clear(); unavailable = true; return
        }
        if profile == loadedProfile, webView != nil {
            // Same DJ, warm widget: nothing to reload.
            if autoplay, !unavailable { play() }
            return
        }
        trackTitle = ""; progress = 0; positionMs = 0; durationMs = 0
        isPlaying = false; isLoading = true; unavailable = false
        loadedProfile = profile
        startWatchdog()

        if webView == nil {
            buildWebView(initialProfile: profile, autoplay: autoplay)
        } else if ready {
            eval("scLoad(\(Self.jsString(profile)), \(autoplay))")
        } else {
            // web view exists but not ready yet — swap the source and let READY fire.
            webView?.loadHTMLString(Self.html(profile: profile, autoplay: autoplay),
                                    baseURL: URL(string: "https://w.soundcloud.com"))
        }
    }

    func toggle() { isPlaying ? pause() : play() }

    func play() {
        guard !unavailable else { return }
        isLoading = true
        startWatchdog()
        eval("scPlay()")
    }

    func pause() { eval("scPause()") }

    func seek(fraction: Double) {
        guard !unavailable, durationMs > 0 else { return }
        let f = min(1, max(0, fraction))
        progress = f
        positionMs = f * durationMs
        eval("scSeek(\(f))")
    }

    /// Leaving the DJ sheet: stop the audio but keep the widget warm, so coming
    /// back (to this DJ or another) is a profile swap and not a cold boot.
    func suspend() {
        watchdog?.cancel(); watchdog = nil
        eval("scPause()")
        isPlaying = false
        isLoading = false
    }

    /// Stop and tear the player down (frees the web view).
    func close() {
        eval("scPause()")
        webView?.removeFromSuperview()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "dj")
        webView = nil
        clear()
    }

    private func clear() {
        dj = nil; ready = false; loadedProfile = nil
        isPlaying = false; isLoading = false; unavailable = false
        progress = 0; positionMs = 0; durationMs = 0; trackTitle = ""
        watchdog?.cancel(); watchdog = nil
    }

    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            try? await Task.sleep(for: Self.loadTimeout)
            guard !Task.isCancelled, let self, self.isLoading else { return }
            self.markUnavailable()
        }
    }

    fileprivate func markUnavailable() {
        watchdog?.cancel(); watchdog = nil
        isLoading = false
        isPlaying = false
        // Only a profile that never produced a playable track is "unavailable";
        // one that already gave us a title is simply between events.
        if trackTitle.isEmpty || durationMs <= 0 { unavailable = true }
    }

    // MARK: - Web view

    private func buildWebView(initialProfile: String, autoplay: Bool) {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []   // the tap was the gesture
        cfg.userContentController.add(self, name: "dj")

        // Off-screen, but a real player-sized box: WebKit throttles work in
        // views collapsed to a pixel, which is enough to stall the widget's
        // bootstrap and lose its first metadata reply.
        let web = WKWebView(frame: CGRect(x: 0, y: -400, width: 320, height: 166), configuration: cfg)
        web.isHidden = false          // .isHidden can suspend media — keep it "visible" but off-screen
        web.alpha = 0.01
        web.isUserInteractionEnabled = false
        // Attach off-screen to the key window so media is allowed to play.
        keyWindow()?.addSubview(web)
        webView = web
        web.loadHTMLString(Self.html(profile: initialProfile, autoplay: autoplay),
                           baseURL: URL(string: "https://w.soundcloud.com"))
    }

    private func eval(_ js: String) {
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
    }

    // MARK: - Helpers

    /// The catalogue stores "https://www.soundcloud.com/kink"; the widget
    /// resolver wants the canonical "https://soundcloud.com/kink". A bare
    /// handle is accepted too, since that is what a hand-entered value looks
    /// like.
    ///
    /// Anything that isn't a soundcloud.com profile or track is rejected rather
    /// than handed to the widget: a few rows hold a URL pasted into itself
    /// ("soundcloud.com/https://raul-mezcolanza"), and `URL(string:)` accepts
    /// those happily — they would render a player card that can never load.
    static func canonicalSoundCloud(_ raw: String?) -> URL? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty
        else { return nil }
        if !s.lowercased().hasPrefix("http") {
            guard !s.contains("/"), !s.contains(":") else { return nil }
            s = "https://soundcloud.com/" + s.replacingOccurrences(of: "@", with: "")
        }
        guard var comps = URLComponents(string: s),
              let host = comps.host?.lowercased(),
              host == "soundcloud.com" || host.hasSuffix(".soundcloud.com")
        else { return nil }

        // A profile is one path segment, a track is two, a set is three
        // ("/kink/sets/live"). Deeper than that, or a segment carrying a scheme,
        // means the value is malformed rather than a page SoundCloud can serve.
        let segments = comps.path.split(separator: "/").map(String.init)
        guard (1...3).contains(segments.count),
              !segments.contains(where: { $0.contains(":") })
        else { return nil }

        comps.scheme = "https"
        comps.host = "soundcloud.com"
        comps.path = "/" + segments.joined(separator: "/")
        comps.query = nil
        comps.fragment = nil
        return comps.url
    }

    /// Quote a value for embedding in the JS we evaluate.
    private static func jsString(_ raw: String) -> String {
        let escaped = raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        return "'\(escaped)'"
    }

    static func timeLabel(_ ms: Double) -> String {
        let total = Int((ms / 1000).rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private static func html(profile: String, autoplay: Bool) -> String {
        let encoded = profile.addingPercentEncoding(
            withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        ) ?? profile
        let src = "https://w.soundcloud.com/player/?url=\(encoded)"
            + "&auto_play=\(autoplay)&visual=false&hide_related=true&show_comments=false"
            + "&show_user=true&show_teaser=false&sharing=false&buying=false&download=false"
            + "&single_active=false&color=%23C09950"
        return """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}iframe{width:100%;height:100%;border:0}</style>
        </head><body>
        <iframe id="w" allow="autoplay" src="\(src)"></iframe>
        <script src="https://w.soundcloud.com/player/api.js"></script>
        <script>
        var w = SC.Widget(document.getElementById('w'));
        function post(m){ try{ window.webkit.messageHandlers.dj.postMessage(m); }catch(e){} }

        // A profile URL resolves to that artist's tracks, so the title and
        // duration have to be ASKED for. The widget only answers once its own
        // bootstrap has finished, which is often after READY fires — a single
        // ask on READY is the reason a player could sit on "Loading track…"
        // forever with a live 0:00 / 0:00 under it.
        //
        // So ask repeatedly over a short window and then stop. A live profile
        // answers within ~100ms of READY, so the later steps only exist to
        // cover a slow bootstrap; giving up at ~3.4s and saying so beats a
        // longer wait, because "no preview" is the honest answer by then.
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
        // in quick succession can't leave overlapping chains asking for the
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
        """
    }
}

extension DJPlayer: WKScriptMessageHandler {
    nonisolated func userContentController(_ controller: WKUserContentController,
                                           didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        Task { @MainActor in
            switch type {
            case "ready":
                self.ready = true
                if !self.isPlaying { self.isLoading = false }
            case "loaded":
                self.isLoading = false
            case "play":
                self.isPlaying = true; self.isLoading = false; self.unavailable = false
            case "pause":
                self.isPlaying = false; self.isLoading = false
            case "finish":
                self.isPlaying = false; self.progress = 0; self.positionMs = 0
            case "title":
                if let t = body["title"] as? String, !t.isEmpty {
                    self.trackTitle = t; self.unavailable = false
                }
            case "nometa", "error":
                self.markUnavailable()
            case "duration":
                if let d = body["ms"] as? Double { self.durationMs = d }
                else if let d = body["ms"] as? Int { self.durationMs = Double(d) }
            case "progress":
                if let rel = body["rel"] as? Double { self.progress = max(0, min(1, rel)) }
                if let pos = body["ms"] as? Double { self.positionMs = pos }
                else if let pos = body["ms"] as? Int { self.positionMs = Double(pos) }
            default: break
            }
        }
    }
}

// MARK: - In-sheet control (our own gold player)

/// Player card for the DJ sheet — the `.dj-player` box from the Club Fuoco DJ
/// Page design: accent play button, track title over a "SoundCloud preview"
/// overline, a waveform, and the running times, on a bordered surface card.
///
/// The waveform IS the scrubber. In the comp it is decoration; here the bars
/// carry the played fraction and take the drag, so the design's most
/// characteristic element does the work the old flat slider did rather than
/// sitting next to a duplicate control.
struct DJPlayerControl: View {
    @Environment(DJPlayer.self) private var player
    @Environment(LocaleStore.self) private var locale
    @State private var scrubbing: Double?          // fraction while dragging

    /// The comp's bar heights (32 bars, 28pt tall). A fixed figure, not random:
    /// it must not reshuffle on every redraw while audio is playing.
    private static let barHeights: [CGFloat] = [
        6, 11, 17, 9, 22, 14, 26, 10, 18, 24, 8, 15, 20, 12, 27, 9,
        16, 21, 11, 25, 13, 19, 7, 23, 17, 10, 14, 22, 9, 18, 12, 20,
    ]

    private var lineStrong: Color { Theme.fadedSand.opacity(0.34) }

    /// Not every artist has a playable profile — roughly one in ten of the
    /// handles we hold is dead or carries no public track. That is a state, not
    /// a transient, and the card says so rather than spinning on it.
    private var dead: Bool { player.unavailable }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Button { Haptics.tap(); player.toggle() } label: {
                    ZStack {
                        Circle().fill(dead ? Theme.fadedSand.opacity(0.25) : Theme.ember)
                            .frame(width: 38, height: 38)
                        if player.isLoading {
                            ProgressView().tint(Theme.cream)
                        } else {
                            Image(systemName: dead ? "slash.circle"
                                                   : (player.isPlaying ? "pause.fill" : "play.fill"))
                                .font(.system(size: 14))
                                .foregroundStyle(dead ? Theme.fadedSand : Theme.cream)
                                .offset(x: player.isPlaying || dead ? 0 : 1.5)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(dead)

                VStack(alignment: .leading, spacing: 4) {
                    Text(titleLine)
                        .font(.cfSans(13.5, weight: .semibold))
                        .foregroundStyle(dead ? Theme.stone : Theme.ink)
                        .lineLimit(1)
                    Text(locale.t("dj.soundcloudPreview").uppercased())
                        .font(.cfMono(9)).kerning(0.9)
                        .foregroundStyle(Theme.fadedSand)
                }
                Spacer(minLength: 0)
            }

            waveform.padding(.top, 14)

            // Times belong to a track. With nothing to play, "0:00 / 0:00" reads
            // like a player that failed rather than one with nothing to show.
            if !dead {
                HStack {
                    Text(DJPlayer.timeLabel(player.positionMs))
                    Spacer()
                    Text(DJPlayer.timeLabel(player.durationMs))
                }
                .font(.cfMono(8.5)).kerning(0.5)
                .foregroundStyle(Theme.fadedSand)
                .padding(.top, 8)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(lineStrong))
        .animation(.easeInOut(duration: 0.18), value: dead)
    }

    private var titleLine: String {
        if dead { return locale.t("dj.previewUnavailable") }
        return player.trackTitle.isEmpty ? locale.t("dj.loadingTrack") : player.trackTitle
    }

    private var waveform: some View {
        GeometryReader { geo in
            let frac = scrubbing ?? player.progress
            let played = dead ? 0 : Int((Double(Self.barHeights.count) * frac).rounded())
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(Array(Self.barHeights.enumerated()), id: \.offset) { i, h in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(i < played ? Theme.ember : lineStrong)
                        .frame(height: h)
                }
            }
            .frame(width: geo.size.width, height: 28, alignment: .bottom)
            .opacity(dead ? 0.45 : 1)
            // The bars are 2pt apart, so hit-test the whole strip rather than
            // the glyphs — otherwise a scrub lands between bars and does nothing.
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        guard !dead else { return }
                        scrubbing = min(1, max(0, v.location.x / max(geo.size.width, 1)))
                    }
                    .onEnded { v in
                        guard !dead else { return }
                        let f = min(1, max(0, v.location.x / max(geo.size.width, 1)))
                        player.seek(fraction: f)
                        scrubbing = nil
                    }
            )
        }
        .frame(height: 28)
    }
}
