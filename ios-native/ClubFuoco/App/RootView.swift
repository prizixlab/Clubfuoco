import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.api) private var api
    @State private var router = InviteLinkRouter.shared
    private static let notifPromptKey = "cf.notifPromptShown"

    var body: some View {
        Group {
            // Note: if/else keeps AuthFlowView's identity stable while the signup
            // wizard signs the user in mid-flow (signedOut → signedIn while
            // onboardingInProgress) — a switch over state would reset the wizard.
            if auth.state == .loading {
                SplashView()
            } else if auth.state == .signedIn
                        && !auth.onboardingInProgress
                        && !(auth.profile?.isComplete ?? false)
                        // …unless an invite is open. Signing in from a ticket is
                        // the whole point of the reduced lane: swapping the
                        // screen underneath for the profile wizard at that exact
                        // moment would dismiss the sheet they are standing in and
                        // demand four more fields. The wall still comes — on the
                        // next launch, or the moment they close the invite.
                        && router.pendingToken == nil {
                // Existing user with a restored session whose profile is missing
                // a required field (e.g. gender, added 2026-06-22). Block the
                // app behind complete-profile until they fill it in. The signup
                // wizard sets onboardingInProgress=true so it isn't caught here.
                NavigationStack { CompleteProfileView() }
            } else if auth.onboardingInProgress || (auth.state == .signedOut && !auth.guestMode) {
                AuthFlowView()
            } else {
                MainTabView()
            }
        }
        .sheet(item: Binding(
            get: { router.pendingToken.map(InviteToken.init) },
            set: { if $0 == nil { router.pendingToken = nil } }
        )) { wrapped in
            InviteClaimView(token: wrapped.value)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .task { await maybePromptNotifications() }
        // Recover an invite tapped before the app was installed. Runs once per
        // install, and only ever pre-fills the sheet above — see InviteHandoff.
        .task { await InviteHandoff.resolveIfNeeded(api: api) }
    }

    /// Fires the iOS notification permission dialog directly on app open —
    /// no in-app explainer, just the system prompt. Once per install,
    /// only when status is .notDetermined.
    ///
    /// Either way we then ask APNs for a push token: the prompt only runs once,
    /// so a user who granted permission on an earlier launch (or a fresh
    /// install of an already-permitted app) still gets registered. Both calls
    /// are no-ops when permission was denied.
    private func maybePromptNotifications() async {
        if !UserDefaults.standard.bool(forKey: Self.notifPromptKey) {
            UserDefaults.standard.set(true, forKey: Self.notifPromptKey)
            _ = await NotificationService.shared.requestAuthorization()
        }
        await PushRegistrar.shared.registerIfAuthorized()
    }
}

private struct InviteToken: Identifiable {
    let value: String
    var id: String { value }
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
                    .background(Theme.surface.opacity(0.55), in: .rect(cornerRadius: 14))
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .padding(.top, 60)
        }
    }
}
