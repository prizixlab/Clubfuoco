import SwiftUI

/// The active offer supplier's lockup on the booking sheet — restores the
/// branding the supplier had before the swappable-partner refactor, but
/// data-driven from GET /api/partner so it follows whichever brand is active.
///
/// Rumba gets its signature treatment back: the bundled wordmark masking a
/// gloss sweep in the brand color (#FF2D92 → white → back), same as the old
/// RumbalistMark / RumbalistBookSheet.tsx. Any other supplier renders its
/// remote logo at the same size, or its name in the brand color when no logo
/// is set. Confined to the booking flow — app chrome stays Club Fuoco.
struct SupplierMark: View {
    let brand: PartnerBrand
    var height: CGFloat = 18
    var animated: Bool = true
    /// Repaint the mark in this color. Supplier logos are single-ink wordmarks
    /// with their ink baked into the PNG, so a light mark is invisible on a
    /// light surface. Pass the surrounding text color on light cards; leave it
    /// nil on dark ones, where the supplier's own ink is what they intended.
    var tint: Color? = nil

    /// The bundled Rumbalist wordmark's aspect ratio (1600×325).
    private static let rumbaAspect: CGFloat = 1600.0 / 325.0

    @State private var sweep: CGFloat = -1

    private var accent: Color { Color(hexString: brand.color) ?? Theme.ember }

    var body: some View {
        if brand.key == "rumba" {
            rumbaGloss
        } else if let url = brand.logoURL {
            AsyncImage(url: url) { image in
                if let tint {
                    // Template rendering keeps the glyph shapes and discards the
                    // baked-in ink, so the mark takes the surface's text color.
                    image.renderingMode(.template).resizable().scaledToFit()
                        .foregroundStyle(tint)
                } else {
                    image.resizable().scaledToFit()
                }
            } placeholder: {
                nameText
            }
            .frame(height: height)
        } else {
            nameText
        }
    }

    /// The pre-refactor Rumbalist look: brand-pink gloss sweeping through the
    /// bundled wordmark.
    private var rumbaGloss: some View {
        LinearGradient(
            stops: [
                .init(color: accent, location: 0.0),
                .init(color: accent, location: 0.38),
                .init(color: .white, location: 0.50),
                .init(color: accent, location: 0.62),
                .init(color: accent, location: 1.0),
            ],
            startPoint: UnitPoint(x: sweep, y: 0.5),
            endPoint: UnitPoint(x: sweep + 1.6, y: 0.5)
        )
        .mask(
            Image("rumbalist-logo")
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
        )
        .frame(width: height * Self.rumbaAspect, height: height)
        .onAppear {
            guard animated else { return }
            withAnimation(.easeInOut(duration: 3.4).repeatForever(autoreverses: false)) {
                sweep = 1
            }
        }
    }

    private var nameText: some View {
        Text(brand.name.uppercased())
            .font(.cfSans(height * 0.85, weight: .bold))
            .kerning(height * 0.12)
            .foregroundStyle(tint ?? accent)
            .lineLimit(1)
    }
}

extension Color {
    /// Parse "#RRGGBB" / "RRGGBB" (the partner_brands.color format).
    /// Fails soft — callers fall back to Theme.ember.
    init?(hexString: String) {
        let cleaned = hexString.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "#", with: "")
        guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else { return nil }
        self.init(hex: value)
    }
}
