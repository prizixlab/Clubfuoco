import SwiftUI
import UIKit

// Turning a promoter's mark into the exact bitmaps a Wallet pass bundle needs.
//
// PassKit has no typography controls — pass.json carries no font or text-colour
// field, and `logoText` is drawn by iOS in the system font tinted with the
// pass's foreground colour. So a promoter who wants their own typeface gets it
// the only way it can be had: we typeset the wordmark here and ship it as the
// logo IMAGE. An uploaded logo takes the same path, which is why both end up in
// one renderer.
//
// Rendering on the device rather than the server means the preview is honest by
// construction — the screen shows the very bitmap that gets uploaded — and it
// keeps a native image library out of a serverless function.

enum PassLogoRenderer {

    /// The slots a pass bundle needs, at the sizes PassKit expects. Logo is
    /// capped at 160×50pt, icon is 29pt square; the server re-checks every one
    /// of these dimensions before it will store them.
    static let logoSizes: [(field: String, size: CGSize)] = [
        ("logo1x", CGSize(width: 160, height: 50)),
        ("logo2x", CGSize(width: 320, height: 100)),
        ("logo3x", CGSize(width: 480, height: 150)),
    ]
    static let iconSizes: [(field: String, size: CGSize)] = [
        ("icon1x", CGSize(width: 29, height: 29)),
        ("icon2x", CGSize(width: 58, height: 58)),
        ("icon3x", CGSize(width: 87, height: 87)),
    ]

    /// The faces the app ships, offered as wordmark options. Stored by
    /// PostScript name; `font(for:)` maps an unknown one back to the default
    /// rather than rendering a missing glyph.
    struct Face: Identifiable, Hashable {
        let id: String          // PostScript name, what we persist
        let label: String       // what the promoter sees
        var isSystem: Bool { id.hasPrefix("__system") }
    }

    static let faces: [Face] = [
        .init(id: "InstrumentSerif-Regular", label: "Serif"),
        .init(id: "InstrumentSerif-Italic",  label: "Serif Italic"),
        .init(id: "Geist-SemiBold",          label: "Sans"),
        .init(id: "Geist-Bold",              label: "Sans Bold"),
        .init(id: "GeistMono-Medium",        label: "Mono"),
        .init(id: "__system-rounded",        label: "Rounded"),
    ]

    static let defaultFace = faces[0]

    /// A UIFont for a stored face id, at a given point size.
    static func uiFont(_ faceId: String?, size: CGFloat) -> UIFont {
        let id = faceId ?? defaultFace.id
        if id == "__system-rounded" {
            let base = UIFont.systemFont(ofSize: size, weight: .bold)
            guard let d = base.fontDescriptor.withDesign(.rounded) else { return base }
            return UIFont(descriptor: d, size: size)
        }
        return UIFont(name: id, size: size)
            ?? UIFont(name: defaultFace.id, size: size)
            ?? UIFont.systemFont(ofSize: size, weight: .semibold)
    }

    /// SwiftUI equivalent, for the on-screen preview.
    static func font(_ faceId: String?, size: CGFloat) -> Font {
        Font(uiFont(faceId, size: size) as CTFont)
    }

    // MARK: - Rendering

    /// The six PNGs for a typeset wordmark.
    ///
    /// The logo slots are transparent so the wordmark sits directly on the pass
    /// background. The icon slots are NOT: an icon shows in the Wallet list and
    /// in notifications, over surfaces we do not control, so it is drawn on the
    /// pass's own background colour to guarantee the mark stays visible.
    static func renderText(
        _ text: String,
        face: String?,
        color: UIColor,
        background: UIColor
    ) -> [String: Data] {
        var out: [String: Data] = [:]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return out }

        for (field, size) in logoSizes {
            out[field] = png(size: size, opaque: false) { ctx in
                draw(text: trimmed, face: face, color: color, in: CGRect(origin: .zero, size: size))
            }
        }
        // The icon is 29pt square — a wordmark is illegible there, so it
        // carries the initial instead, which is what a favicon would do.
        let initial = String(trimmed.prefix(1)).uppercased()
        for (field, size) in iconSizes {
            out[field] = png(size: size, opaque: true) { _ in
                background.setFill()
                UIBezierPath(rect: CGRect(origin: .zero, size: size)).fill()
                draw(text: initial, face: face, color: color,
                     in: CGRect(origin: .zero, size: size).insetBy(dx: size.width * 0.18,
                                                                   dy: size.height * 0.18))
            }
        }
        return out
    }

    /// The six PNGs for an uploaded image.
    ///
    /// Aspect-FIT, never fill: a promoter's mark is as likely to be a wide
    /// wordmark as a square badge, and cropping one to fill the box is how you
    /// cut the end off someone's name. This app has already had to fix exactly
    /// that bug once on the You tab.
    static func renderImage(_ image: UIImage, background: UIColor) -> [String: Data] {
        var out: [String: Data] = [:]
        for (field, size) in logoSizes {
            out[field] = png(size: size, opaque: false) { _ in
                image.draw(in: fit(image.size, into: size))
            }
        }
        for (field, size) in iconSizes {
            out[field] = png(size: size, opaque: true) { _ in
                background.setFill()
                UIBezierPath(rect: CGRect(origin: .zero, size: size)).fill()
                let box = CGRect(origin: .zero, size: size).insetBy(dx: size.width * 0.12,
                                                                    dy: size.height * 0.12)
                image.draw(in: fit(image.size, into: box.size).offsetBy(dx: box.minX, dy: box.minY))
            }
        }
        return out
    }

    // MARK: - Primitives

    /// Renders at scale 1 so the pixel dimensions ARE the point dimensions —
    /// the server rejects anything that is not exactly the expected size, and
    /// the default renderer scale would silently produce 3x that on a modern
    /// phone.
    private static func png(size: CGSize, opaque: Bool, _ body: (CGContext) -> Void) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.pngData { ctx in body(ctx.cgContext) }
    }

    /// Largest rect of `source`'s aspect ratio that fits inside `box`, centred.
    private static func fit(_ source: CGSize, into box: CGSize) -> CGRect {
        guard source.width > 0, source.height > 0 else { return CGRect(origin: .zero, size: box) }
        let scale = min(box.width / source.width, box.height / source.height)
        let w = source.width * scale, h = source.height * scale
        return CGRect(x: (box.width - w) / 2, y: (box.height - h) / 2, width: w, height: h)
    }

    /// Draw text as large as it can be while still fitting the box.
    ///
    /// Binary search rather than a fixed size: the same 160×50 box has to hold
    /// "M7" and "Nova Weekends Collective", and a font size that suits one
    /// clips the other.
    private static func draw(text: String, face: String?, color: UIColor, in box: CGRect) {
        var lo: CGFloat = 4, hi = box.height * 1.6, best: CGFloat = 4
        for _ in 0..<12 {
            let mid = (lo + hi) / 2
            let size = (text as NSString).size(withAttributes: [.font: uiFont(face, size: mid)])
            if size.width <= box.width && size.height <= box.height { best = mid; lo = mid }
            else { hi = mid }
        }
        let font = uiFont(face, size: best)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let size = (text as NSString).size(withAttributes: attrs)
        let origin = CGPoint(x: box.midX - size.width / 2, y: box.midY - size.height / 2)
        (text as NSString).draw(at: origin, withAttributes: attrs)
    }
}
