import SwiftUI
import CoreLocation
import UIKit

/// Natural content height of the location sheet, used to fit the nearby
/// detent to its content so nothing clips at the bottom.
private struct SheetContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// Two-mode pre-prompt for the iOS location ladder.
///
///   .nearby   — fired the first time the user opens Explore. Asks for
///               WhenInUse only ("see the clubs closest to you tonight").
///               No step list because the OS shows a single dialog here.
///
///   .arrival  — fired after a booking is confirmed (or from Settings as a
///               fallback). Asks for Always so iOS can wake the app on
///               geofence entry the night of the booking. Shows the two-step
///               instructions because the OS shows two dialogs back to back.
///               Also primes the system by doing a real foreground location
///               read between the two asks — iOS is much more likely to show
///               the "Change to Always Allow" upgrade dialog when it has seen
///               the app actually use location, not just request it.
///
/// Apple won't let us collapse this into a single "Always or Never" prompt —
/// the system dialog buttons are fixed. The Settings deep-link is the
/// official fallback when iOS suppresses the upgrade dialog (which it will
/// for some users; that's a heuristic we can't override).
struct LocationPermissionSheet: View {
    enum Mode { case nearby, arrival }

    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleStore.self) private var locale

    let mode: Mode

    private enum Step { case explain, openSettings }
    @State private var step: Step = .explain
    @State private var requesting = false
    @State private var contentHeight: CGFloat = 0

    /// Nearby mode is sized to its content so the "Not now" link always clears
    /// the bottom (a fixed `.medium` detent clipped it on shorter phones /
    /// larger Dynamic Type). Arrival mode keeps `.large` — it has the longer
    /// step list and wants the button pinned to the bottom.
    private var detents: Set<PresentationDetent> {
        if mode == .arrival { return [.large] }
        return contentHeight > 0 ? [.height(contentHeight)] : [.medium]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Icon and close button share the top row — the icon anchors the
            // left, the X the right. (Previously the X sat alone on its own row
            // with the icon dropped into the corner below, which read as
            // misplaced.)
            HStack(alignment: .top) {
                Image(systemName: mode == .nearby ? "location.magnifyingglass" : "mappin.and.ellipse")
                    .font(.system(size: 32, weight: .light))
                    .foregroundStyle(Theme.wine)
                    .frame(width: 64, height: 64)
                    .background(Theme.wine.opacity(0.08), in: .circle)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.stone)
                        .frame(width: 32, height: 32)
                }
            }

            Text(locale.t(titleKey))
                .font(.cfSerif(32, italic: true))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text(locale.t(bodyKey))
                .font(.cfSans(14))
                .foregroundStyle(Theme.stone)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(3)

            if mode == .arrival { stepsList } else { nearbyTip }

            // Arrival (.large) pins the button to the bottom with a flexible
            // spacer; nearby is content-sized, so a fixed gap keeps its natural
            // height measurable (a flexible spacer would expand to the detent
            // and defeat the fit).
            if mode == .arrival {
                Spacer(minLength: 0)
            } else {
                Spacer().frame(height: 8)
            }

            PrimaryButton(title: locale.t(ctaKey), loading: requesting) { tapPrimary() }

            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Text(locale.t("location.notNow"))
                    .font(.cfSans(13))
                    .foregroundStyle(Theme.fadedSand)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
            }
        }
        .padding(24)
        .background(Theme.cream)
        .background(
            // Measure the natural content height so the nearby detent fits it
            // exactly. The extra inset leaves room for the home indicator.
            GeometryReader { proxy in
                Color.clear.preference(key: SheetContentHeightKey.self,
                                       value: proxy.size.height + 28)
            }
        )
        .onPreferenceChange(SheetContentHeightKey.self) { contentHeight = $0 }
        .presentationDetents(detents)
        .presentationDragIndicator(.visible)
    }

    // ── Copy keys per mode/step ──────────────────────────────────────────────

    private var titleKey: String {
        switch (mode, step) {
        case (.nearby, _):              return "location.nearby.title"
        case (.arrival, .explain):      return "location.title"
        case (.arrival, .openSettings): return "location.settingsTitle"
        }
    }
    private var bodyKey: String {
        switch (mode, step) {
        case (.nearby, _):              return "location.nearby.body"
        case (.arrival, .explain):      return "location.body"
        case (.arrival, .openSettings): return "location.settingsBody"
        }
    }
    private var ctaKey: String {
        switch (mode, step) {
        case (.nearby, _):              return "location.nearby.enable"
        case (.arrival, .explain):      return "location.enable"
        case (.arrival, .openSettings): return "location.openSettings"
        }
    }

    // ── Step rows (arrival mode only) ────────────────────────────────────────

    /// Single highlighted callout for the nearby mode. The OS dialog only has
    /// one button we want them on — making the right tap unmissable.
    private var nearbyTip: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "hand.tap.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.wine)
                .frame(width: 26, height: 26)
                .background(Theme.wine.opacity(0.1), in: .circle)
            Text(stepText("location.nearby.tip"))
                .font(.cfSans(14))
                .foregroundStyle(Theme.ink)
                .tint(Theme.wine)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
        }
        .padding(14)
        .background(Theme.surface.opacity(0.6), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
    }

    @ViewBuilder
    private var stepsList: some View {
        let keys: [String] = step == .explain
            ? ["location.step1", "location.step2"]
            : ["location.settingsStep1", "location.settingsStep2", "location.settingsStep3"]
        VStack(alignment: .leading, spacing: 10) {
            if step == .explain {
                Text(locale.t("location.stepsHeader"))
                    .font(.cfMono(10))
                    .kerning(1.4)
                    .foregroundStyle(Theme.fadedSand)
                    .padding(.bottom, 2)
            }
            ForEach(Array(keys.enumerated()), id: \.offset) { i, key in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(i + 1)")
                        .font(.cfSerif(15, italic: true))
                        .foregroundStyle(Theme.wine)
                        .frame(width: 26, height: 26)
                        .background(Theme.wine.opacity(0.1), in: .circle)
                    Text(stepText(key))
                        .font(.cfSans(14))
                        .foregroundStyle(Theme.ink)
                        .tint(Theme.wine)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                }
            }
        }
        .padding(14)
        .background(Theme.surface.opacity(0.6), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.hairline))
    }

    private func stepText(_ key: String) -> AttributedString {
        let raw = locale.t(key)
        guard var s = try? AttributedString(markdown: raw) else {
            return AttributedString(raw)
        }
        for run in s.runs where run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true {
            s[run.range].foregroundColor = Theme.wine
        }
        return s
    }

    // ── Primary action ───────────────────────────────────────────────────────

    private func tapPrimary() {
        Haptics.tap()
        switch (mode, step) {
        case (.nearby, _):
            requesting = true
            Task {
                let svc = LocationService.shared
                if svc.authorizationStatus == .notDetermined {
                    svc.requestWhenInUseAuthorization()
                    // Best-effort read primes Explore's distance sort and
                    // satisfies the iOS heuristic that later allows the
                    // Always upgrade dialog to fire.
                    _ = try? await svc.currentLocation()
                }
                requesting = false
                dismiss()
            }

        case (.arrival, .explain):
            requesting = true
            Task {
                let svc = LocationService.shared

                // Step 1 — first-time WhenInUse dialog. Wait for the user's
                // ACTUAL answer (delegate callback), never a fixed sleep:
                // requesting Always while the first dialog is still on screen
                // makes iOS silently drop it, so the upgrade dialog never
                // appeared and users who tapped Allow still landed on the
                // Settings fallback.
                if svc.authorizationStatus == .notDetermined {
                    svc.requestWhenInUseAuthorization()
                    await svc.waitForAuthorizationChange(seconds: 60)
                }

                if svc.authorizationStatus == .authorizedWhenInUse {
                    // Real foreground location read — iOS uses recent location
                    // activity as a heuristic for whether to show the upgrade
                    // dialog when we then request Always. Worth waiting for.
                    _ = try? await svc.currentLocation()
                    // Step 2 — the "Change to Always Allow" upgrade dialog,
                    // now that the first dialog is fully answered. Waked by
                    // the delegate on grant; times out if the user picks
                    // "Keep Only While Using" (no status change, no callback).
                    svc.requestAlwaysAuthorization()
                    if svc.authorizationStatus != .authorizedAlways {
                        await svc.waitForAuthorizationChange(seconds: 15)
                    }
                }

                requesting = false
                if svc.authorizationStatus == .authorizedAlways {
                    Haptics.success()
                    dismiss()
                } else {
                    // Denied / kept WhenInUse / restricted — the OS won't ask
                    // again, so route through Settings.
                    step = .openSettings
                }
            }

        case (.arrival, .openSettings):
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            dismiss()
        }
    }
}
