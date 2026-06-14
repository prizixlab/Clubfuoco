import SwiftUI

/// The Rumbalist wordmark — the brand logo masking the signature pink gloss
/// (#FF2D92 → white → pink), with the slow sweep animation from the web
/// (RumbalistMark in RumbalistBookSheet.tsx). Sized by height; the width
/// follows the logo's 1600×325 aspect ratio.
struct RumbalistMark: View {
    var height: CGFloat = 18
    var animated: Bool = true

    static let pink = Color(hex: 0xFF2D92)
    private static let aspect: CGFloat = 1600.0 / 325.0

    @State private var sweep: CGFloat = -1

    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Self.pink, location: 0.0),
                .init(color: Self.pink, location: 0.38),
                .init(color: .white,    location: 0.50),
                .init(color: Self.pink, location: 0.62),
                .init(color: Self.pink, location: 1.0),
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
        .frame(width: height * Self.aspect, height: height)
        .onAppear {
            guard animated else { return }
            withAnimation(.easeInOut(duration: 3.4).repeatForever(autoreverses: false)) {
                sweep = 1
            }
        }
    }
}
