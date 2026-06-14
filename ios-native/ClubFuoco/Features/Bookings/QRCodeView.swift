import SwiftUI
import CoreImage.CIFilterBuiltins

/// Real scannable QR for booking tokens — replaces the web's placeholder
/// pattern (a native win: staff check-in scans the qr_code_token directly).
struct QRCodeView: View {
    let token: String

    var body: some View {
        if let image = Self.generate(token) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
        } else {
            Image(systemName: "qrcode")
                .resizable()
                .scaledToFit()
                .foregroundStyle(Theme.ink)
        }
    }

    static func generate(_ string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
