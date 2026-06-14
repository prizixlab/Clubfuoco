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
                        ProgressView().tint(.white).scaleEffect(0.8)
                    } else {
                        Image(systemName: "wallet.pass.fill")
                            .font(.system(size: compact ? 11 : 13))
                    }
                    Text(locale.t("wallet.add"))
                        .font(.cfSans(compact ? 11 : 13, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, compact ? 10 : 16)
                .padding(.vertical, compact ? 7 : 11)
                .background(.black, in: .capsule)
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

/// Presents PKAddPassesViewController modally from the key window and resolves
/// when the user finishes (added or cancelled).
@MainActor
private enum WalletPresenter {
    static func present(_ pass: PKPass) async throws {
        guard
            let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
            var top = scene.keyWindow?.rootViewController
        else { throw WalletError.noPresenter }

        while let presented = top.presentedViewController { top = presented }

        guard let controller = PKAddPassesViewController(pass: pass) else {
            throw WalletError.invalidPass
        }

        let delegate = AddPassesDelegate()
        controller.delegate = delegate

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            delegate.onFinish = {
                continuation.resume()
            }
            top.present(controller, animated: true)
        }
    }

    enum WalletError: Error { case noPresenter, invalidPass }
}

/// Retains itself until the add sheet finishes.
private final class AddPassesDelegate: NSObject, PKAddPassesViewControllerDelegate {
    var onFinish: (() -> Void)?
    private var selfRef: AddPassesDelegate?

    override init() {
        super.init()
        selfRef = self   // keep alive while the controller is up
    }

    func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
        controller.dismiss(animated: true) { [weak self] in
            self?.onFinish?()
            self?.selfRef = nil
        }
    }
}
