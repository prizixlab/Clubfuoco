import SwiftUI

/// Tinted placeholder with a slow horizontal sweep — the only loading
/// primitive in the app. Used by `SplashView` (boot skeleton) and
/// `ExploreView.skeleton` (feed loading) so they animate identically.
struct ShimmerBlock: View {
    var corner: CGFloat = 8
    @State private var sweep: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: corner)
            .fill(Theme.hairline.opacity(0.55))
            .overlay {
                GeometryReader { geo in
                    LinearGradient(
                        gradient: Gradient(stops: [
                            .init(color: .clear,                    location: 0),
                            .init(color: Color.white.opacity(0.4),  location: 0.5),
                            .init(color: .clear,                    location: 1),
                        ]),
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.55)
                    .offset(x: geo.size.width * sweep)
                    .blendMode(.plusLighter)
                }
            }
            .clipShape(.rect(cornerRadius: corner))
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                    sweep = 1.4
                }
            }
    }
}
