import SwiftUI

/// Shared top bar used across the main tabs: "Fuoco" serif wordmark with an
/// optional leading avatar and a trailing bell. Sits on the night background
/// with a hairline divider below.
struct FuocoHeader: View {
    var showAvatar: Bool = true
    var initials: String = ""
    /// When set, the avatar shows this logo image instead of the initials
    /// (used on the supplier You tab to show the brand mark).
    var logoURL: String? = nil
    /// When set, the trailing icon becomes a gear running this action (used on
    /// the You tab to open Settings) instead of the static bell.
    var onSettings: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                if showAvatar {
                    Circle()
                        .fill(Theme.nightLift)
                        .overlay {
                            if let s = logoURL, let u = URL(string: s) {
                                AsyncImage(url: u) { img in
                                    img.resizable().scaledToFit().padding(5)
                                } placeholder: {
                                    Text(initials.isEmpty ? "·" : initials)
                                        .font(.cfSerif(16)).foregroundStyle(Theme.flame)
                                }
                            } else {
                                Text(initials.isEmpty ? "·" : initials)
                                    .font(.cfSerif(16)).foregroundStyle(Theme.flame)
                            }
                        }
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Theme.hairline))
                        .frame(width: 34, height: 34)
                }
                Text("Fuoco")
                    .font(.cfSerif(28))
                    .foregroundStyle(Theme.parchment)
                Spacer()
                if let onSettings {
                    Button { Haptics.tap(); onSettings() } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 18))
                            .foregroundStyle(Theme.flame)
                    }
                } else {
                    Image(systemName: "bell")
                        .font(.system(size: 18))
                        .foregroundStyle(Theme.flame)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            Rectangle().fill(Theme.hairline).frame(height: 1)
        }
    }
}
