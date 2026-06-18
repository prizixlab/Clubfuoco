import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        // Note: if/else keeps AuthFlowView's identity stable while the signup
        // wizard signs the user in mid-flow (signedOut → signedIn while
        // onboardingInProgress) — a switch over state would reset the wizard.
        if auth.state == .loading {
            SplashView()
        } else if auth.onboardingInProgress || (auth.state == .signedOut && !auth.guestMode) {
            AuthFlowView()
        } else {
            MainTabView()
        }
    }
}

/// Boot skeleton — cream background + ghost cards mirroring the explore feed
/// so the transition into the loaded app doesn't flash a dark wordmark. Built
/// on the shared `ShimmerBlock` primitive used by `ExploreView`.
struct SplashView: View {
    var body: some View {
        ZStack(alignment: .top) {
            Theme.cream.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 14) {
                    ShimmerBlock(corner: 4).frame(width: 130, height: 22)
                    HStack(spacing: 10) {
                        ForEach(0..<3, id: \.self) { _ in
                            ShimmerBlock(corner: 15).frame(width: 78, height: 30)
                        }
                    }
                }
                ZStack(alignment: .bottomLeading) {
                    ShimmerBlock(corner: 18).frame(height: 220)
                    VStack(alignment: .leading, spacing: 10) {
                        ShimmerBlock(corner: 4).frame(width: 80, height: 10)
                        ShimmerBlock(corner: 4).frame(width: 220, height: 22)
                        ShimmerBlock(corner: 4).frame(width: 160, height: 18)
                    }
                    .padding(16)
                }
                ForEach(0..<3, id: \.self) { _ in
                    HStack(spacing: 12) {
                        ShimmerBlock(corner: 12).frame(width: 72, height: 72)
                        VStack(alignment: .leading, spacing: 8) {
                            ShimmerBlock(corner: 4).frame(width: 180, height: 16)
                            ShimmerBlock(corner: 4).frame(width: 120, height: 12)
                            ShimmerBlock(corner: 4).frame(width: 80, height: 10)
                        }
                        Spacer()
                    }
                    .padding(14)
                    .background(Color.white.opacity(0.55), in: .rect(cornerRadius: 14))
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .padding(.top, 60)
        }
    }
}
