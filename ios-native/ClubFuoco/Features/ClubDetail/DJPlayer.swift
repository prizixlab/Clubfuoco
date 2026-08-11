import SwiftUI
import WebKit
import Observation

// App-level SoundCloud audio engine + our own gold UI.
//
// SoundCloud's player is a locked iframe, so we can't restyle it — but its JS
// Widget API lets us drive a HIDDEN widget (play/pause/seek + progress/title
// events) and build our own controls on top. The web view lives here in a
// singleton (attached off-screen to the key window), not inside any sheet, so
// audio KEEPS PLAYING when the DJ sheet closes and the user browses on. A
// persistent mini-bar (DJMiniBar) surfaces it app-wide.
//
// No background/lock-screen playback (no UIBackgroundModes: audio) — audio runs
// only while the app is foregrounded, by design.

@MainActor
@Observable
final class DJPlayer: NSObject {
    static let shared = DJPlayer()

    // Now-playing state (observed by the controls + mini-bar).
    private(set) var dj: FeaturedDJ?
    private(set) var isPlaying = false
    private(set) var isLoading = false
    private(set) var progress: Double = 0        // 0…1 of the current track
    private(set) var positionMs: Double = 0
    private(set) var durationMs: Double = 0
    private(set) var trackTitle = ""

    var isActive: Bool { dj != nil }

    private var webView: WKWebView?
    private var ready = false
    private var loadedProfile: String?           // avoid reloading the same DJ

    private nonisolated override init() { super.init() }

    // MARK: - Control

    /// Point the player at a DJ. Always loads that DJ (taking over any current
    /// playback); only starts playing when `autoplay` is true.
    func open(_ dj: FeaturedDJ, autoplay: Bool) {
        self.dj = dj
        guard let profile = Self.canonicalSoundCloud(dj.soundcloud)?.absoluteString else {
            reset(); return
        }
        if profile == loadedProfile, webView != nil {
            if autoplay { play() }
            return
        }
        trackTitle = ""; progress = 0; positionMs = 0; durationMs = 0
        isPlaying = false; isLoading = true
        loadedProfile = profile

        if webView == nil {
            buildWebView(initialProfile: profile, autoplay: autoplay)
        } else if ready {
            eval("scLoad('\(profile)', \(autoplay))")
        } else {
            // web view exists but not ready yet — swap the source and let READY fire.
            webView?.loadHTMLString(Self.html(profile: profile, autoplay: autoplay),
                                    baseURL: URL(string: "https://w.soundcloud.com"))
        }
    }

    func toggle() { isPlaying ? pause() : play() }
    func play()   { isLoading = true; eval("scPlay()") }
    func pause()  { eval("scPause()") }

    func seek(fraction: Double) {
        let f = min(1, max(0, fraction))
        progress = f
        positionMs = f * durationMs
        eval("scSeek(\(f))")
    }

    /// Stop and tear the player down (frees the web view).
    func close() {
        eval("scPause()")
        webView?.removeFromSuperview()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "dj")
        webView = nil
        reset()
    }

    private func reset() {
        dj = nil; ready = false; loadedProfile = nil
        isPlaying = false; isLoading = false
        progress = 0; positionMs = 0; durationMs = 0; trackTitle = ""
    }

    // MARK: - Web view

    private func buildWebView(initialProfile: String, autoplay: Bool) {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []   // the tap was the gesture
        cfg.userContentController.add(self, name: "dj")

        let web = WKWebView(frame: CGRect(x: 0, y: -2, width: 1, height: 1), configuration: cfg)
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

    /// RA stores "https://www.soundcloud.com/kink"; the widget resolver wants
    /// the canonical "https://soundcloud.com/kink".
    static func canonicalSoundCloud(_ raw: String?) -> URL? {
        guard var s = raw?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        s = s.replacingOccurrences(of: "://www.soundcloud.com", with: "://soundcloud.com")
        return URL(string: s)
    }

    static func timeLabel(_ ms: Double) -> String {
        let total = Int((ms / 1000).rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private static func html(profile: String, autoplay: Bool) -> String {
        let src = "https://w.soundcloud.com/player/?url=\(profile)"
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
        function meta(){ w.getCurrentSound(function(s){ if(s&&s.title) post({type:'title',title:s.title}); });
                         w.getDuration(function(d){ post({type:'duration',ms:d}); }); }
        w.bind(SC.Widget.Events.READY, function(){ post({type:'ready'}); meta(); });
        w.bind(SC.Widget.Events.PLAY, function(){ post({type:'play'}); meta(); });
        w.bind(SC.Widget.Events.PAUSE, function(){ post({type:'pause'}); });
        w.bind(SC.Widget.Events.FINISH, function(){ post({type:'finish'}); });
        w.bind(SC.Widget.Events.PLAY_PROGRESS, function(e){ post({type:'progress',ms:e.currentPosition,rel:e.relativePosition}); });
        function scPlay(){ w.play(); }
        function scPause(){ w.pause(); }
        function scSeek(f){ w.getDuration(function(d){ w.seekTo(Math.floor(d*f)); }); }
        function scLoad(url, ap){ w.load(url, { auto_play: ap, visual:false, hide_related:true,
            show_comments:false, show_user:true, sharing:false, buying:false, download:false,
            single_active:false, color:'%23C09950',
            callback: function(){ post({type:'loaded'}); meta(); if(ap){ w.play(); } } }); }
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
                self.isPlaying = true; self.isLoading = false
            case "pause":
                self.isPlaying = false; self.isLoading = false
            case "finish":
                self.isPlaying = false; self.progress = 0; self.positionMs = 0
            case "title":
                if let t = body["title"] as? String { self.trackTitle = t }
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

/// Full player row for the DJ sheet — gold play/pause, track title, and a
/// draggable gold scrubber. Bound to the shared DJPlayer.
struct DJPlayerControl: View {
    @Environment(DJPlayer.self) private var player
    @State private var scrubbing: Double?          // fraction while dragging

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                Button { Haptics.tap(); player.toggle() } label: {
                    ZStack {
                        Circle().fill(Theme.gold).frame(width: 52, height: 52)
                        if player.isLoading {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 19))
                                .foregroundStyle(.white)
                                .offset(x: player.isPlaying ? 0 : 2)
                        }
                    }
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 3) {
                    Text(player.trackTitle.isEmpty ? "Loading…" : player.trackTitle)
                        .font(.cfSans(13, weight: .medium))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text("VIA SOUNDCLOUD")
                        .font(.cfMono(9)).kerning(0.8)
                        .foregroundStyle(Theme.fadedSand)
                }
                Spacer(minLength: 0)
            }

            scrubber

            HStack {
                Text(DJPlayer.timeLabel(player.positionMs))
                Spacer()
                Text("-" + DJPlayer.timeLabel(max(0, player.durationMs - player.positionMs)))
            }
            .font(.cfMono(10))
            .foregroundStyle(Theme.fadedSand)
        }
        .padding(16)
        .background(Theme.cream, in: .rect(cornerRadius: 14))
    }

    private var scrubber: some View {
        GeometryReader { geo in
            let frac = scrubbing ?? player.progress
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.fadedSand.opacity(0.3)).frame(height: 4)
                Capsule().fill(Theme.gold).frame(width: geo.size.width * frac, height: 4)
                Circle().fill(Theme.gold).frame(width: 12, height: 12)
                    .offset(x: geo.size.width * frac - 6)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in scrubbing = min(1, max(0, v.location.x / geo.size.width)) }
                    .onEnded { v in
                        let f = min(1, max(0, v.location.x / geo.size.width))
                        player.seek(fraction: f); scrubbing = nil
                    }
            )
        }
        .frame(height: 16)
    }
}

// MARK: - Persistent mini-bar

/// App-wide now-playing bar shown above the tab bar while a DJ is loaded, so
/// audio keeps playing as the user navigates. Tapping it reopens the DJ.
struct DJMiniBar: View {
    @Environment(DJPlayer.self) private var player
    /// Reopen the DJ detail (mini-bar has no club context, so no guestlist CTA).
    let onTapDJ: (FeaturedDJ) -> Void

    var body: some View {
        if let dj = player.dj {
            HStack(spacing: 12) {
                artwork(dj)
                VStack(alignment: .leading, spacing: 2) {
                    Text(dj.name).font(.cfSans(13, weight: .semibold))
                        .foregroundStyle(Theme.ink).lineLimit(1)
                    Text(player.trackTitle.isEmpty ? "SoundCloud" : player.trackTitle)
                        .font(.cfMono(9)).foregroundStyle(Theme.fadedSand).lineLimit(1)
                }
                Spacer(minLength: 6)
                Button { Haptics.tap(); player.toggle() } label: {
                    ZStack {
                        Circle().fill(Theme.gold).frame(width: 34, height: 34)
                        if player.isLoading {
                            ProgressView().tint(.white).scaleEffect(0.7)
                        } else {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 13)).foregroundStyle(.white)
                                .offset(x: player.isPlaying ? 0 : 1)
                        }
                    }
                }
                .buttonStyle(.plain)
                Button { Haptics.tap(); player.close() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.fadedSand)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
            }
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: .rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.gold.opacity(0.35)))
            .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
            .contentShape(Rectangle())
            .onTapGesture { onTapDJ(dj) }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func artwork(_ dj: FeaturedDJ) -> some View {
        Group {
            if let raw = dj.imageUrl, let url = URL(string: raw) {
                CachedAsyncImage(url: url, targetWidth: 80) {
                    $0.resizable().aspectRatio(contentMode: .fill)
                } placeholder: { Theme.cream }
            } else {
                Image(systemName: "music.note").foregroundStyle(Theme.fadedSand)
                    .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.cream)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(.rect(cornerRadius: 8))
    }
}
