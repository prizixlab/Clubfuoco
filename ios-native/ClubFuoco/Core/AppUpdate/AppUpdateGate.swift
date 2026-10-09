import SwiftUI
import UIKit

/// Forces an update when this build is older than the server's minimum
/// (GET /api/app/version). The server owns the rule — the live App Store
/// version once it has been out long enough for every store to offer it, or a
/// pinned version, or nothing at all — so forcing can be changed or switched
/// off without an app release.
///
/// Never blocks on doubt: no answer, a malformed answer, or no minimum means
/// the app runs as normal.
@MainActor
final class AppUpdateGate {
    static let shared = AppUpdateGate()
    private init() {}

    private var window: UIWindow?
    private var checking = false

    /// This build's marketing version, e.g. "1.17".
    static var installed: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    func check(api: APIClient, locale: LocaleStore) async {
        if checking { return }
        checking = true
        defer { checking = false }
        struct Reply: Decodable, Sendable { let minimum: String?; let storeUrl: String? }
        guard let reply: Reply = try? await api.get("/api/app/version") else { return }
        let url = reply.storeUrl.flatMap(URL.init(string:))
            ?? URL(string: "https://apps.apple.com/app/id6770632084")!
        if let minimum = reply.minimum, Self.isOlder(Self.installed, than: minimum) {
            show(storeURL: url, locale: locale)
        } else {
            hide()   // the minimum was lowered or switched off
        }
    }

    /// Numeric, component by component: "1.9" < "1.17" < "1.17.1".
    nonisolated static func isOlder(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }
        let y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l < r }
        }
        return false
    }

    /// Its own window above everything — sheets, alerts, the tab bar — so
    /// nothing already on screen can sit on top of it.
    private func show(storeURL: URL, locale: LocaleStore) {
        guard window == nil,
              let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive })
                ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first
        else { return }
        let w = UIWindow(windowScene: scene)
        w.windowLevel = .alert + 1
        w.rootViewController = UIHostingController(
            rootView: UpdateRequiredView(storeURL: storeURL).environment(locale))
        w.makeKeyAndVisible()
        window = w
    }

    private func hide() {
        window?.isHidden = true
        window = nil
    }
}

struct UpdateRequiredView: View {
    let storeURL: URL
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        ZStack {
            Theme.cream.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer()
                Image(systemName: "arrow.down.app.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(Theme.gold)
                Text(locale.t("update.title"))
                    .font(.cfSerif(34, italic: true))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                Text(locale.t("update.body"))
                    .font(.cfSans(15))
                    .foregroundStyle(Theme.ink.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Spacer()
                Button {
                    UIApplication.shared.open(storeURL)
                } label: {
                    Text(locale.t("update.button"))
                        .font(.cfSans(16, weight: .semibold))
                        .foregroundStyle(Theme.cream)
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .background(Theme.ink, in: .capsule)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
    }
}
