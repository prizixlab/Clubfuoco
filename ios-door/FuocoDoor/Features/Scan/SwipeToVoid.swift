import SwiftUI

/// Slide-to-confirm track (like slide-to-power-off). A void reverses money /
/// allowance state, so it must be deliberate — a tap is too easy to hit at a
/// crowded door (§3). Fires `onVoid` only when dragged past ~85% of the track.
struct SwipeToVoid: View {
    var label: String = "Slide to void"
    var onVoid: () -> Void

    @State private var offset: CGFloat = 0
    @State private var committed = false
    private let knob: CGFloat = 52

    var body: some View {
        GeometryReader { geo in
            let maxX = geo.size.width - knob - 8
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.wine.opacity(0.22))
                Capsule().stroke(Theme.wine.opacity(0.5), lineWidth: 1)

                Text(committed ? "Voided" : label)
                    .font(.cfSans(14, weight: .semibold))
                    .foregroundStyle(Theme.parchment.opacity(0.75))
                    .frame(maxWidth: .infinity)

                // Progress fill trailing the knob.
                Capsule().fill(Theme.wine.opacity(0.35))
                    .frame(width: offset + knob)

                Circle()
                    .fill(Theme.wine)
                    .overlay(Image(systemName: committed ? "checkmark" : "xmark")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.emberCream))
                    .frame(width: knob, height: knob)
                    .offset(x: offset + 4)
                    .gesture(
                        DragGesture()
                            .onChanged { g in
                                guard !committed else { return }
                                offset = min(max(0, g.translation.width), maxX)
                            }
                            .onEnded { _ in
                                guard !committed else { return }
                                if offset > maxX * 0.85 {
                                    committed = true
                                    withAnimation(.spring(response: 0.25)) { offset = maxX }
                                    Haptics.heavy()
                                    onVoid()
                                } else {
                                    withAnimation(.spring(response: 0.3)) { offset = 0 }
                                }
                            }
                    )
            }
        }
        .frame(height: knob + 8)
    }
}
