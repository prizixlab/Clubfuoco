import SwiftUI

/// The night's VIP areas on one map. Nothing selected: the whole venue — one
/// plan with every area's tables and names ("shared"), or the areas as tiles
/// when the venue only publishes close-ups ("areas"). Tapping an area selects
/// it and zooms onto its tables; "All areas" zooms back out.
struct FVVenueMap: View {
    let layout: FVVipMap?
    /// The night's table zones that have a map.
    let zones: [FVProduct]
    let selected: FVProduct?
    let selectedRate: String?
    let onSelectZone: (FVProduct?) -> Void
    let onPickTable: (FVSpace) -> Void
    @Environment(LocaleStore.self) private var locale

    private var shared: Bool { layout?.shared ?? (Set(zones.compactMap { $0.map?.image }).count <= 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if selected != nil {
                    Button {
                        Haptics.tap()
                        withAnimation(.snappy(duration: 0.45)) { onSelectZone(nil) }
                    } label: {
                        Label(locale.t("fv.allAreas"), systemImage: "arrow.down.right.and.arrow.up.left")
                            .font(.cfSans(12, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(locale.t("fv.pickArea")).font(.cfSans(12)).opacity(0.6)
                }
                Spacer()
            }
            if shared {
                sharedMap
            } else if let z = selected, let map = z.map {
                FVTableMap(map: map, selectedRate: selectedRate, onPick: onPickTable)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            } else {
                tiles.transition(.opacity)
            }
        }
    }

    // ── One plan for the venue ────────────────────────────────────────────────

    private var sharedMap: some View {
        let zone = selected
        // Zoomed: that area's own picture (its highlighted variant) and tables.
        let map: FVZoneMap = if let z = zone, let m = z.map {
            m
        } else {
            FVZoneMap(image: layout?.overview ?? zones.first?.map?.image,
                      spaces: zones.flatMap { $0.map?.spaces ?? [] },
                      painted: zones.first?.map?.painted ?? false)
        }
        let focus = zone?.map.map { Self.bounds($0.spaces) }
        return GeometryReader { g in
            let side = g.size.width
            let (k, ox, oy) = Self.zoom(focus, side: side)
            ZStack(alignment: .topLeading) {
                FVTableMap(map: map, selectedRate: zone == nil ? nil : selectedRate,
                           onTapPlan: zone == nil ? { pt in
                               if let z = Self.area(at: pt, in: zones) {
                                   Haptics.tap()
                                   withAnimation(.snappy(duration: 0.45)) { onSelectZone(z) }
                               }
                           } : nil) { space in
                    if zone == nil {
                        if let z = zones.first(where: { $0.map?.spaces.contains(space) == true }) {
                            Haptics.tap()
                            withAnimation(.snappy(duration: 0.45)) { onSelectZone(z) }
                        }
                    } else {
                        onPickTable(space)
                    }
                }
                .frame(width: side, height: side)
                if zone == nil { labels(side: side) }
            }
            .frame(width: side, height: side, alignment: .topLeading)
            .scaleEffect(k, anchor: .topLeading)
            .offset(x: ox, y: oy)
            .frame(width: side, height: side, alignment: .topLeading)
            .clipShape(.rect(cornerRadius: 12))
        }
        .aspectRatio(1, contentMode: .fit)
    }

    /// Each area's name, over its tables, so the overview reads as areas.
    private func labels(side: CGFloat) -> some View {
        ForEach(zones) { z in
            if let m = z.map, !m.spaces.isEmpty {
                let b = Self.bounds(m.spaces)
                Button {
                    Haptics.tap()
                    withAnimation(.snappy(duration: 0.45)) { onSelectZone(z) }
                } label: {
                    Text(FVText.pretty(z.title(locale.locale)) ?? "")
                        .font(.cfSans(10, weight: .bold))
                        .lineLimit(1)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(.black.opacity(0.72), in: .capsule)
                        .foregroundStyle(.white)
                        .fixedSize()
                }
                .buttonStyle(.plain)
                .position(x: side * b.midX / 100, y: side * max(b.minY - 3, 3) / 100)
            }
        }
    }

    // ── Close-ups only: the areas as tiles ───────────────────────────────────

    private var tiles: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(zones) { z in
                Button {
                    Haptics.tap()
                    withAnimation(.snappy(duration: 0.45)) { onSelectZone(z) }
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        if let m = z.map {
                            FVTableMap(map: m, selectedRate: nil, interactive: false) { _ in }
                        }
                        Text(FVText.pretty(z.title(locale.locale)) ?? "")
                            .font(.cfSans(12, weight: .semibold)).lineLimit(1)
                        if let from = z.rates?.map(\.price).filter({ $0 > 0 }).min() {
                            Text(String(format: locale.t("fv.tierVipSub"), from.euros))
                                .font(.cfSans(11)).opacity(0.6)
                        }
                    }
                    .opacity(z.soldOut ? 0.4 : 1)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(z.soldOut)
            }
        }
    }

    // ── Geometry (percent of the square plan) ────────────────────────────────

    /// The area under a tap: one whose tables' box (with a margin) holds the
    /// point, else the nearest one.
    static func area(at p: CGPoint, in zones: [FVProduct]) -> FVProduct? {
        let boxes = zones.compactMap { z in z.map.map { (z, bounds($0.spaces)) } }
        if let hit = boxes.filter({ $0.1.insetBy(dx: -6, dy: -6).contains(p) })
            .min(by: { $0.1.width * $0.1.height < $1.1.width * $1.1.height }) { return hit.0 }
        return boxes.min(by: { hypot($0.1.midX - p.x, $0.1.midY - p.y) < hypot($1.1.midX - p.x, $1.1.midY - p.y) })?.0
    }

    static func bounds(_ spaces: [FVSpace]) -> CGRect {
        guard !spaces.isEmpty else { return CGRect(x: 0, y: 0, width: 100, height: 100) }
        var x0 = 100.0, y0 = 100.0, x1 = 0.0, y1 = 0.0
        for sp in spaces {
            if let b = sp.box, b.count == 4 {          // traced outline
                x0 = min(x0, b[0]); x1 = max(x1, b[0] + b[2])
                y0 = min(y0, b[1]); y1 = max(y1, b[1] + b[3])
                continue
            }
            let half = sp.w * (sp.s ?? 1) / 2
            let cx = sp.left + sp.w / 2, cy = sp.top + sp.w / 2
            x0 = min(x0, cx - half); x1 = max(x1, cx + half)
            y0 = min(y0, cy - half); y1 = max(y1, cy + half)
        }
        return CGRect(x: x0, y: y0, width: max(x1 - x0, 1), height: max(y1 - y0, 1))
    }

    /// Scale and offset that bring `focus` (percent rect) to fill the square,
    /// with a margin, never zooming past 3.5× or showing past the plan's edge.
    static func zoom(_ focus: CGRect?, side: CGFloat) -> (CGFloat, CGFloat, CGFloat) {
        guard let f = focus else { return (1, 0, 0) }
        let pad = 10.0
        let k = min(max(min(100 / (f.width + pad * 2), 100 / (f.height + pad * 2)), 1), 3.5)
        let cx = side * f.midX / 100, cy = side * f.midY / 100
        let ox = min(0, max(side - side * k, side / 2 - cx * k))
        let oy = min(0, max(side - side * k, side / 2 - cy * k))
        return (k, ox, oy)
    }
}
