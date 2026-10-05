import SwiftUI

/// A zone's floor plan with its tables, drawn the way Fourvenues draws it, so
/// the guest can see where the zone sits and which tables a price buys.
/// Fourvenues assigns the exact table at the venue — tapping one here picks
/// that table's price, it does not reserve that table.
struct FVTableMap: View {
    let map: FVZoneMap
    /// The rate currently chosen — its tables are ringed, the rest recede.
    let selectedRate: String?
    let onPick: (FVSpace) -> Void

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack(alignment: .topLeading) {
                Color(white: 0.78)
                if let url = map.image.flatMap(URL.init(string:)) {
                    CachedAsyncImage(url: url) {
                        $0.resizable().aspectRatio(contentMode: .fit)
                    } placeholder: { Color(white: 0.78) }
                    .frame(width: side, height: side, alignment: .leading)
                }
                ForEach(map.spaces) { sp in table(sp, side: side) }
            }
            .frame(width: side, height: side)
            .clipShape(.rect(cornerRadius: 12))
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func table(_ sp: FVSpace, side: CGFloat) -> some View {
        let box = side * sp.w / 100
        let size = box * (sp.s ?? 1)
        let center = CGPoint(x: side * (sp.left + sp.w / 2) / 100, y: side * (sp.top + sp.w / 2) / 100)
        let ours = selectedRate.map { sp.rates.contains($0) } ?? false
        let fill = sp.rgb.flatMap { c -> Color? in
            c.count >= 3 ? Color(red: Double(c[0]) / 255, green: Double(c[1]) / 255, blue: Double(c[2]) / 255) : nil
        } ?? Color.gray
        let corner = size * min(max(sp.r ?? 10, 0), 50) / 100
        return Button {
            guard sp.available else { return }
            Haptics.tap()
            onPick(sp)
        } label: {
            RoundedRectangle(cornerRadius: corner)
                .fill(sp.available ? fill : Color(white: 0.45))
                .overlay {
                    RoundedRectangle(cornerRadius: corner)
                        .stroke(ours ? Color.white : Color.black.opacity(0.35), lineWidth: ours ? 3 : 1)
                }
                .overlay {
                    if !sp.available {
                        Image(systemName: "xmark").font(.system(size: size * 0.35, weight: .bold))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }
                .shadow(color: ours ? .white.opacity(0.8) : .clear, radius: ours ? 5 : 0)
                .frame(width: size, height: size)
                .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .rotationEffect(.degrees(sp.rot ?? 0))
        .opacity(sp.available ? (selectedRate == nil || ours ? 1 : 0.45) : 0.6)
        .position(center)
        .accessibilityLabel([sp.name, sp.cap.map { "\($0)" }].compactMap { $0 }.joined(separator: ", "))
    }
}
