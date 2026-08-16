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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Button { Haptics.tap(); player.toggle() } label: {
                    ZStack {
                        Circle().fill(Theme.ember).frame(width: 38, height: 38)
                        if player.isLoading {
                            ProgressView().tint(Theme.cream)
                        } else {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.cream)
                                .offset(x: player.isPlaying ? 0 : 1.5)
                        }
                    }
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 4) {
                    Text(player.trackTitle.isEmpty ? locale.t("dj.loadingTrack") : player.trackTitle)
                        .font(.cfSans(13.5, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(locale.t("dj.soundcloudPreview").uppercased())
                        .font(.cfMono(9)).kerning(0.9)
                        .foregroundStyle(Theme.fadedSand)
                }
                Spacer(minLength: 0)
            }

            waveform.padding(.top, 14)

            HStack {
                Text(DJPlayer.timeLabel(player.positionMs))
                Spacer()
                Text(DJPlayer.timeLabel(player.durationMs))
            }
            .font(.cfMono(8.5)).kerning(0.5)
            .foregroundStyle(Theme.fadedSand)
            .padding(.top, 8)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(lineStrong))
    }

    private var waveform: some View {
        GeometryReader { geo in
            let frac = scrubbing ?? player.progress
            let played = Int((Double(Self.barHeights.count) * frac).rounded())
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(Array(Self.barHeights.enumerated()), id: \.offset) { i, h in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(i < played ? Theme.ember : lineStrong)
                        .frame(height: h)
                }
            }
            .frame(width: geo.size.width, height: 28, alignment: .bottom)
            // The bars are 2pt apart, so hit-test the whole strip rather than
            // the glyphs — otherwise a scrub lands between bars and does nothing.
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        scrubbing = min(1, max(0, v.location.x / max(geo.size.width, 1)))
                    }
                    .onEnded { v in
                        let f = min(1, max(0, v.location.x / max(geo.size.width, 1)))
                        player.seek(fraction: f)
                        scrubbing = nil
                    }
            )
        }
        .frame(height: 28)
    }
}
