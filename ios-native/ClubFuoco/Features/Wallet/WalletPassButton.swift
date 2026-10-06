import SwiftUI
import PassKit

/// "Add to Apple Wallet" — fetches a .pkpass from the existing server
/// endpoints (signed server-side with the pass certificate; the pass
/// web-service handles updates/push) and presents the native add sheet.
///
/// PKAddPassesViewController must be presented modally by UIKit — embedding
/// it in a SwiftUI `.sheet` renders blank. So we present it directly from the
/// top view controller.
struct WalletPassButton: View {
    /// e.g. "/api/bookings/<id>/wallet" or "/api/membership/wallet/<userId>"
    let passPath: String
    var compact = false
    /// Stretch to fill the width as a rounded bar (vs. a hug-content capsule).
    var fullWidth = false
    /// Cream-on-black instead of white-on-black — for dark surfaces.
    var light = false

    @Environment(\.api) private var api
    @Environment(LocaleStore.self) private var locale
    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                Haptics.tap()
                addPass()
            } label: {
                HStack(spacing: 6) {
                    if loading {
                        ProgressView().tint(light ? .black : .white).scaleEffect(0.8)
                    } else {
                        Image(systemName: "wallet.pass.fill")
                            .font(.system(size: compact ? 11 : 13))
                    }
                    Text(locale.t("wallet.add"))
                        .font(.cfSans(compact ? 11 : 13, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(light ? .black : .white)
                .padding(.horizontal, fullWidth ? 0 : (compact ? 10 : 16))
                .padding(.vertical, fullWidth ? 0 : (compact ? 7 : 11))
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .frame(height: fullWidth ? 46 : nil)
                .background {
                    let fill = light ? Color(hex: 0xF3EEE0) : Color.black
                    if fullWidth {
                        RoundedRectangle(cornerRadius: 12).fill(fill)
                    } else {
                        Capsule().fill(fill)
                    }
                }
            }
            .disabled(loading)

            if let errorMessage {
                Text(errorMessage)
                    .font(.cfSans(10))
                    .foregroundStyle(Theme.wine)
            }
        }
    }

    private func addPass() {
        loading = true
        errorMessage = nil
        Task {
            do {
                let data = try await api.rawData(passPath)
                let pass = try PKPass(data: data)
                try await WalletPresenter.present(pass)
            } catch {
                errorMessage = locale.t("wallet.error")
            }
            loading = false
        }
    }
}

/// Presents PKAddPassesViewController modally from the top-most controller.
@MainActor
private enum WalletPresenter {
    static func present(_ pass: PKPass) async throws {
        // Already in Wallet: open it there instead of a second add sheet.
        let library = PKPassLibrary()
        if library.containsPass(pass), let url = pass.passURL {
            await UIApplication.shared.open(url)
            return
        }
        guard
            let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
            var top = scene.keyWindow?.rootViewController
        else { throw WalletError.noPresenter }

        // The top-most controller that is staying on screen: presenting on one
        // that is mid-dismiss, or already presenting, is an UIKit exception.
        while let presented = top.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        // One add sheet at a time: a second present while the first is up is
        // what UIKit traps on.
        if top is PKAddPassesViewController { return }
        guard !top.isBeingDismissed, top.viewIfLoaded?.window != nil else {
            throw WalletError.noPresenter
        }

        guard let controller = PKAddPassesViewController(pass: pass) else {
            throw WalletError.invalidPass
        }

        // Fire and forget. This used to await the sheet through a
        // continuation, which crashes if PassKit reports "finished" twice and
        // hangs forever if the sheet is torn down without reporting at all.
        let delegate = AddPassesDelegate()
        controller.delegate = delegate
        top.present(controller, animated: true)
    }

    enum WalletError: Error { case noPresenter, invalidPass }
}

/// Retains itself until the add sheet finishes; safe to be told more than once.
private final class AddPassesDelegate: NSObject, PKAddPassesViewControllerDelegate {
    private var selfRef: AddPassesDelegate?

    override init() {
        super.init()
        selfRef = self   // keep alive while the controller is up
    }

    func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
        guard selfRef != nil else { return }
        selfRef = nil
        if controller.presentingViewController != nil, !controller.isBeingDismissed {
            controller.dismiss(animated: true)
        }
    }
}

#if DEBUG
/// Device test hook: CF_TEST_WALLET=<pass path> presents that pass's add sheet
/// a few seconds after launch, exactly as the button would.
@MainActor
enum WalletDebug {
    static func runIfRequested(api: APIClient) async {
        guard let path = ProcessInfo.processInfo.environment["CF_TEST_WALLET"] else { return }
        try? await Task.sleep(for: .seconds(4))
        do {
            let data = try await api.rawData(path)
            NSLog("CF_TEST_WALLET got %d bytes", data.count)
            let pass = try PKPass(data: data)
            NSLog("CF_TEST_WALLET parsed, presenting")
            try await WalletPresenter.present(pass)
            NSLog("CF_TEST_WALLET finished")
        } catch {
            NSLog("CF_TEST_WALLET error %@", String(describing: error))
        }
    }
}
#endif
