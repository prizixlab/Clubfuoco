import SwiftUI
import UIKit

/// "Open invite link" card on the GuestlistView. Shows the public URL, a
/// Copy button, an iOS share-sheet trigger, and a toggle to flip group
/// visibility on the fly (so the promoter can post the link to Instagram
/// without leaking the guestlist).
struct InviteShareCard: View {
    let allocation: PromoterAllocation
    @State private var visible: Bool
    @State private var copied = false
    @State private var saving = false
    @State private var showShare = false

    init(allocation: PromoterAllocation) {
        self.allocation = allocation
        _visible = State(initialValue: allocation.groupVisible ?? true)
    }

    private static let baseURL = "https://clubfuoco.com/i/"

    private var inviteURL: URL? {
        guard let token = allocation.inviteToken else { return nil }
        return URL(string: Self.baseURL + token)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Kicker("Open invite link")
                Spacer()
                if saving { ProgressView().tint(Theme.parchmentDim).scaleEffect(0.7) }
            }

            if let url = inviteURL {
                HStack(spacing: 10) {
                    Text(url.absoluteString)
                        .font(.cfMono(11))
                        .foregroundStyle(Theme.parchmentDim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        UIPasteboard.general.string = url.absoluteString
                        Haptics.success()
                        copied = true
                        Task { try? await Task.sleep(nanoseconds: 1_500_000_000); copied = false }
                    } label: {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(copied ? Theme.flame : Theme.parchment)
                            .frame(width: 32, height: 32)
                            .background(Circle().stroke(Theme.parchmentFaint))
                    }
                    Button {
                        Haptics.tap(); showShare = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.emberCream)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(Theme.ember))
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.night))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.hairline))
            } else {
                Text("Link not yet generated for this guestlist.")
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.parchmentDim)
            }

            Toggle(isOn: Binding(get: { visible }, set: { newVal in
                visible = newVal
                Task { await save(newVal) }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Show the guestlist to invitees")
                        .font(.cfSans(13, weight: .medium))
                        .foregroundStyle(Theme.parchment)
                    Text(visible ? "They'll see who else is coming."
                                 : "They'll only see their own ticket.")
                        .font(.cfSans(11))
                        .foregroundStyle(Theme.parchmentDim)
                }
            }
            .tint(Theme.ember)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
        .sheet(isPresented: $showShare) {
            if let url = inviteURL {
                ShareSheet(items: [
                    "Join my list for \(allocation.night?.displayTitle ?? "the night") on \(allocation.night?.nightDate ?? ""):",
                    url
                ])
                .presentationDetents([.medium, .large])
            }
        }
    }

    private func save(_ newVal: Bool) async {
        saving = true
        defer { saving = false }
        try? await PromoterRepo().setGroupVisible(allocationId: allocation.id, visible: newVal)
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
