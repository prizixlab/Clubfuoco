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
                // Sits on the always-white QR card, so it must not follow the
                // appearance — an adaptive ink would vanish in Dark.
                .foregroundStyle(Theme.onQRSurface)
        }
    }

    /// One CIContext for the whole app.
    ///
    /// Building a CIContext stands up a render pipeline and is among the most
    /// expensive objects in Core Image. This used to be `CIContext()` inline in
    /// `generate`, i.e. a fresh one on every call — and `generate` is called
    /// straight from `body`, on a view that appears on EVERY ticket card as
    /// well as eight other screens. Animating the Tickets/Reviews pager
    /// re-evaluates those bodies once per frame, so switching tabs was building
    /// a Core Image pipeline per visible ticket per frame. That is what made
    /// the switch feel slow after the animation itself was already right.
    private static let context = CIContext()

    /// Memoised by token. The QR for a token never changes, and the same
    /// tokens re-render constantly — a list of tickets, a sheet reopening, a
    /// pager frame. NSCache rather than a dictionary: it is thread-safe, and it
    /// evicts under memory pressure instead of growing for the life of the app.
    private static let cache = NSCache<NSString, UIImage>()

    static func generate(_ string: String) -> UIImage? {
        let key = string as NSString
        if let cached = cache.object(forKey: key) { return cached }

        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }

        let image = UIImage(cgImage: cg)
        cache.setObject(image, forKey: key)
        return image
    }
}
