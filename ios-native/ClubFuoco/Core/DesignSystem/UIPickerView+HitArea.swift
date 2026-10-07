import UIKit

/// SwiftUI's `.pickerStyle(.wheel)` is a UIPickerView that keeps its ~216pt
/// intrinsic height for hit-testing even when framed shorter and `.clipped()`
/// — clipping is visual only, and SwiftUI can't clip a UIKit view's touches.
/// The When planner's 140pt wheel spilled ~38pt over its Done button, so only
/// the button's bottom half took taps. With no intrinsic size the picker takes
/// exactly the frame SwiftUI gives it. Every wheel in the app sets an explicit
/// `.frame(height:)`, so none of them relies on the intrinsic height.
extension UIPickerView {
    override open var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: UIView.noIntrinsicMetric)
    }
}
