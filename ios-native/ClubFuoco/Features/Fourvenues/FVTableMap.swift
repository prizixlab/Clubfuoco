import SwiftUI

/// A zone's floor plan with its tables, drawn the way Fourvenues draws it, so
/// the guest can see where the zone sits and which tables a price buys.
/// Fourvenues assigns the exact table at the venue — tapping one here picks
/// that table's price, it does not reserve that table.
struct FVTableMap: View {
    let map: FVZoneMap
    /// The rate currently chosen — its tables are ringed, the rest recede.
    let selectedRate: String?
    /// false: draw only — taps go to whatever contains the map (a tile).
    var interactive: Bool = true
    /// A tap on the plan outside any table, in percent of the square.
    var onTapPlan: ((CGPoint) -> Void)? = nil
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
                if interactive, let onTapPlan {
                    // The picture itself is tappable, not just the tables.
                    Color.clear
                        .contentShape(Rectangle())
                        .frame(width: side, height: side)
                        .onTapGesture(coordinateSpace: .local) { pt in
                            onTapPlan(CGPoint(x: pt.x / side * 100, y: pt.y / side * 100))
                        }
                }
                if !map.approx {
                    ForEach(map.spaces) { sp in
                        if map.painted, sp.box == nil { marker(sp, side: side) } else { table(sp, side: side) }
                    }
                }
            }
            .frame(width: side, height: side)
            .clipShape(.rect(cornerRadius: 12))
        }
        .aspectRatio(1, contentMode: .fit)
    }

    /// A painted table we couldn't trace: a small dot at the venue's point —
    /// never an outline that might not fit the drawing.
    private func marker(_ sp: FVSpace, side: CGFloat) -> some View {
        let ours = selectedRate.map { sp.rates.contains($0) } ?? false
        let center = CGPoint(x: side * (sp.left + sp.w / 2) / 100, y: side * (sp.top + sp.w / 2) / 100)
        let hit = side * sp.w * (sp.s ?? 1) / 100
        return Button {
            guard sp.available else { return }
            Haptics.tap()
            onPick(sp)
        } label: {
            ZStack {
                Color.clear
                if !sp.available {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white, .black.opacity(0.75))
                } else if ours {
                    Circle().fill(.white).frame(width: 11, height: 11)
                        .overlay(Circle().stroke(.black.opacity(0.6), lineWidth: 1.5))
                        .shadow(color: .white.opacity(0.9), radius: 5)
                }
            }
            .frame(width: max(hit, 22), height: max(hit, 22))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .allowsHitTesting(interactive)
        .position(center)
    }

    private func table(_ sp: FVSpace, side: CGFloat) -> some View {
        // A traced outline is exact: use it as is, no square, no rotation.
        let traced: CGRect? = (map.painted ? sp.box : nil).flatMap { b in
            b.count == 4 ? CGRect(x: side * b[0] / 100, y: side * b[1] / 100,
                                  width: side * b[2] / 100, height: side * b[3] / 100) : nil
        }
        let box: CGFloat = side * CGFloat(sp.w) / 100
        let size: CGFloat = box * CGFloat(sp.s ?? 1)
        let width = traced?.width ?? size
        let height = traced?.height ?? size
        let center = traced.map { CGPoint(x: $0.midX, y: $0.midY) }
            ?? CGPoint(x: side * (sp.left + sp.w / 2) / 100, y: side * (sp.top + sp.w / 2) / 100)
        let ours = selectedRate.map { sp.rates.contains($0) } ?? false
        let fill = sp.rgb.flatMap { c -> Color? in
            c.count >= 3 ? Color(red: Double(c[0]) / 255, green: Double(c[1]) / 255, blue: Double(c[2]) / 255) : nil
        } ?? Color.gray
        let corner = traced != nil ? min(width, height) * 0.18 : size * min(max(sp.r ?? 10, 0), 50) / 100
        return Button {
            guard sp.available else { return }
            Haptics.tap()
            onPick(sp)
        } label: {
            // Painted plans: the picture is the table — only a ring for the
            // chosen price and a mark on taken ones. Bare plans: draw it.
            RoundedRectangle(cornerRadius: corner)
                .fill(map.painted
                      ? (sp.available ? Color.clear : Color.black.opacity(0.55))
                      : (sp.available ? fill : Color(white: 0.45)))
                .overlay {
                    // On a painted plan, ring only a traced outline: a guessed
                    // square over a drawn table reads as misaligned.
                    let ring = ours && (!map.painted || traced != nil)
                    RoundedRectangle(cornerRadius: corner)
                        .stroke(ring ? Color.white : (map.painted ? Color.clear : Color.black.opacity(0.35)),
                                lineWidth: ring ? 3 : 1)
                }
                .overlay {
                    if !sp.available {
                        Image(systemName: "xmark").font(.system(size: min(width, height) * 0.45, weight: .bold))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }
                .shadow(color: ours && (!map.painted || traced != nil) ? .white.opacity(0.8) : .clear,
                        radius: ours ? 5 : 0)
                .frame(width: width + (traced != nil ? 4 : 0), height: height + (traced != nil ? 4 : 0))
                .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(interactive)
        .rotationEffect(.degrees(traced == nil ? (sp.rot ?? 0) : 0))
        .opacity(map.painted ? 1 : (sp.available ? (selectedRate == nil || ours ? 1 : 0.45) : 0.6))
        .position(center)
        .accessibilityLabel([sp.name, sp.cap.map { "\($0)" }].compactMap { $0 }.joined(separator: ", "))
    }
}
