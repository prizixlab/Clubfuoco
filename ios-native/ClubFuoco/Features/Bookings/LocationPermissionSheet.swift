import SwiftUI
import CoreLocation
import UIKit

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

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.stone)
                        .frame(width: 32, height: 32)
                }
            }

            Image(systemName: mode == .nearby ? "location.magnifyingglass" : "mappin.and.ellipse")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(Theme.wine)
                .frame(width: 64, height: 64)
                .background(Theme.wine.opacity(0.08), in: .circle)

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

            Spacer(minLength: 0)

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
        .presentationDetents(mode == .arrival ? [.large] : [.medium])
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
        .background(Color.white.opacity(0.6), in: .rect(cornerRadius: 14))
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
        .background(Color.white.opacity(0.6), in: .rect(cornerRadius: 14))
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
                if svc.authorizationStatus == .notDetermined {
                    svc.requestWhenInUseAuthorization()
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                }
                // Real foreground location read — iOS uses recent location
                // activity as a heuristic for whether to show the upgrade
                // dialog when we then request Always. Worth waiting for.
                _ = try? await svc.currentLocation()
                svc.requestAlwaysAuthorization()
                // Poll for up to 10s instead of a single fixed delay: the
                // user has to tap through TWO sequential iOS dialogs
                // (WhenInUse → Always upgrade), which routinely takes
                // longer than 1.5s. A fixed check fires the fallback even
                // when the user did grant Always a moment later.
                for _ in 0..<20 {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    if svc.authorizationStatus == .authorizedAlways { break }
                }
                requesting = false
                if svc.authorizationStatus == .authorizedAlways {
                    Haptics.success()
                    dismiss()
                } else {
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
