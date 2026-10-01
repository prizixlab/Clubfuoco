import SwiftUI
import UIKit

// Swipe-from-the-left-edge to go back, on a screen that hides the navigation
// bar.
//
// UINavigationController owns that gesture, and it DISABLES it whenever the
// navigation bar is hidden — it assumes a screen with no bar is not a normal
// pushed screen. Any SwiftUI view carrying `.toolbar(.hidden, for:
// .navigationBar)` therefore loses swipe-back, silently, even though it really
// is a push. That is the whole reason the ticket page could only be left via
// its own chevron: the push was correct, the gesture had been switched off
// underneath it.
//
// The fix is to hand the recognizer a delegate that allows it whenever there is
// something to pop back to, and re-enable it. This is deliberately NOT a
// hand-rolled DragGesture: the real recognizer gives the content tracking the
// finger, releasing early to cancel, and the velocity handling, none of which
// are worth reimplementing badly.
extension View {
    /// Restores the system back-swipe on a pushed screen that hides the nav bar.
    func interactivePopEnabled() -> some View {
        background(InteractivePopEnabler().frame(width: 0, height: 0))
    }
}

private struct InteractivePopEnabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController { Holder() }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    final class Holder: UIViewController, UIGestureRecognizerDelegate {
        /// Whatever UIKit had set, so this screen doesn't leave its own delegate
        /// installed on the shared navigation controller after it is gone.
        private weak var previousDelegate: (any UIGestureRecognizerDelegate)?
        private var applied = false

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard !applied, let gesture = navigationController?.interactivePopGestureRecognizer
            else { return }
            previousDelegate = gesture.delegate
            gesture.delegate = self
            gesture.isEnabled = true
            applied = true
        }

        // viewDidDisappear, not viewWillDisappear: "will" fires as the
        // interactive pop STARTS, so restoring there would pull the delegate out
        // from under the gesture that is still running and cancel it halfway.
        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            guard applied, let gesture = navigationController?.interactivePopGestureRecognizer
            else { return }
            gesture.delegate = previousDelegate
            applied = false
        }

        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            // Only when there is a screen underneath. Allowing it on the root
            // wedges the navigation controller.
            (navigationController?.viewControllers.count ?? 0) > 1
        }

        /// The ticket is a vertical ScrollView. Refusing simultaneous
        /// recognition keeps an edge swipe from also scrolling the page.
        func gestureRecognizer(
            _ gesture: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool { false }
    }
}
