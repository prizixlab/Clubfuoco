import SwiftUI
import VisionKit
import AVFoundation

/// Live camera QR reader built on VisionKit's DataScannerViewController. Requires
/// a real device with a camera (won't run in the Simulator) — matches the
/// device-only build policy for the Fuoco apps.
struct QRScannerView: UIViewControllerRepresentable {
    /// Called with a decoded payload. The parent throttles duplicate reads.
    var onScan: (String) -> Void
    /// When false the scanner stops (e.g. while a result sheet is up).
    var isActive: Bool

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr, .aztec, .pdf417])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: true,
            isHighlightingEnabled: true
        )
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {
        if isActive {
            try? vc.startScanning()
        } else {
            vc.stopScanning()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

        func dataScanner(_ scanner: DataScannerViewController, didAdd added: [RecognizedItem],
                         allItems: [RecognizedItem]) {
            for item in added {
                if case let .barcode(bc) = item, let payload = bc.payloadStringValue {
                    onScan(payload)
                }
            }
        }
    }

    /// Whether this device can run the live scanner. Callers show a fallback UI
    /// (manual entry) when false — e.g. Simulator or no camera permission yet.
    static var isSupported: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }
}
