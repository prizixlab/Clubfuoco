import SwiftUI

/// What a promoter can create. Promoters and suppliers are one role — the
/// difference is the THING being made, not the account:
///
///   .privateEvent — a guestlist night at your usual club or a custom pin.
///                   Only people with your invite link see it.
///   .publicOffer  — a free-guestlist / VIP-table offer at a partner venue,
///                   listed publicly on the Club Fuoco app.
enum CreateKind: Identifiable {
    case privateEvent, publicOffer
    var id: Int { self == .privateEvent ? 0 : 1 }
}

/// First step of "+": pick what you're making. Replaces the old account-based
/// branching (supplier accounts used to jump straight to a bare club list).
struct CreateTypeChooser: View {
    var onPick: (CreateKind) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        card(icon: "lock",
                             title: "Private event",
                             sub: "A guestlist night at your usual club or a custom spot. Only people with your link can join.") {
                            onPick(.privateEvent)
                        }
                        card(icon: "megaphone",
                             title: "Public offer",
                             sub: "A free guestlist or VIP table at a partner venue, listed on the Club Fuoco app for everyone.") {
                            onPick(.publicOffer)
                        }

                        Text("Both are reviewed by Club Fuoco before they go live.")
                            .font(.cfSans(12))
                            .foregroundStyle(Theme.parchmentDim)
                            .multilineTextAlignment(.center)
                            .padding(.top, 6)
                    }
                    .padding(24)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.night, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Theme.parchmentDim)
                }
                ToolbarItem(placement: .principal) {
                    Text("What are you creating?")
                        .font(.cfMono(11, weight: .medium))
                        .kerning(2)
                        .foregroundStyle(Theme.flame)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.night)
    }

    private func card(icon: String, title: String, sub: String,
                      action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Theme.ember.opacity(0.15))
                        .frame(width: 52, height: 52)
                    Image(systemName: icon)
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.ember)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.cfSerif(22))
                        .foregroundStyle(Theme.parchment)
                    Text(sub)
                        .font(.cfSans(12))
                        .foregroundStyle(Theme.parchmentDim)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .foregroundStyle(Theme.parchmentDim)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 18).fill(Theme.nightLift))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.hairline))
        }
        .buttonStyle(.plain)
    }
}
