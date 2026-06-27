import SwiftUI

/// Shared top bar used across the main tabs: "Fuoco" serif wordmark with an
/// optional leading avatar and a trailing bell. Sits on the night background
/// with a hairline divider below.
struct FuocoHeader: View {
    var showAvatar: Bool = true
    var initials: String = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                if showAvatar {
                    Circle()
                        .fill(Theme.nightLift)
                        .overlay(
                            Text(initials.isEmpty ? "·" : initials)
                                .font(.cfSerif(16))
                                .foregroundStyle(Theme.flame))
                        .overlay(Circle().stroke(Theme.hairline))
                        .frame(width: 34, height: 34)
                }
                Text("Fuoco")
                    .font(.cfSerif(28))
                    .foregroundStyle(Theme.parchment)
                Spacer()
                Image(systemName: "bell")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.flame)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            Rectangle().fill(Theme.hairline).frame(height: 1)
        }
    }
}
