import SwiftUI
import UIKit

// "Share to Instagram" — previews the generated card and hands it to Instagram.
//
// Instagram only makes a link tappable in a few places, so each action does the
// most it can:
//  • Story — renders the 9:16 card, copies the invite link to the clipboard so
//    the promoter can paste it into a link sticker in one tap, then opens the
//    share sheet (Instagram Stories appears there).
//  • Post  — renders the 4:5 card and shares it (feed captions aren't tappable,
//    so the QR + printed URL on the card carry the link).
//  • DM    — shares the link itself (with the card image); links in Direct ARE
//    tappable.
struct InstagramShareSheet: View {
    let allocation: PromoterAllocation
    let token: String
    let host: String?

    @Environment(\.dismiss) private var dismiss
    @State private var cover: UIImage?
    @State private var loadingCover = true
    @State private var previewFormat: ShareFormat = .story
    @State private var share: SharePayload?
    @State private var copied = false

    private var content: ShareCardContent {
        .from(allocation: allocation, token: token, host: host, cover: cover)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                grabber
                head

                Picker("", selection: $previewFormat) {
                    ForEach(ShareFormat.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 40)

                preview

                VStack(spacing: 12) {
                    action("Share to Story", "square.and.arrow.up", filled: true) { shareStory() }
                    action("Share as Post", "square.on.square") { sharePost() }
                    action("Send link in DM", "paperplane") { shareDM() }
                }
                .padding(.horizontal, 20)

                Text(copied
                     ? "Link copied — in Story, add a link sticker and paste."
                     : "The QR and link are baked into the image, so it works everywhere.")
                    .font(.cfSans(12))
                    .foregroundStyle(copied ? Theme.flame : Theme.parchmentDim)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .animation(.easeInOut, value: copied)

                Spacer(minLength: 20)
            }
            .padding(.top, 10)
        }
        .background(Theme.night.ignoresSafeArea())
        .presentationDetents([.large])
        .task { await loadCover() }
        .sheet(item: $share) { payload in
            ActivityView(items: payload.items)
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: Pieces

    private var grabber: some View {
        Capsule().fill(Theme.parchmentFaint).frame(width: 40, height: 5)
    }

    private var head: some View {
        VStack(spacing: 6) {
            Kicker("Share to Instagram")
            Text(allocation.night?.displayTitle ?? "Your night")
                .font(.cfSerif(30)).foregroundStyle(Theme.parchment)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 24)
    }

    // Live, scaled preview of the actual card view.
    private var preview: some View {
        let size = previewFormat.size
        let targetW: CGFloat = 260
        let scale = targetW / size.width
        return ZStack {
            if loadingCover {
                ProgressView().tint(Theme.parchment)
            } else {
                ShareCardView(content: content, format: previewFormat)
                    .scaleEffect(scale)
                    .frame(width: targetW, height: size.height * scale)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.hairline))
                    .shadow(color: .black.opacity(0.5), radius: 20, y: 10)
            }
        }
        .frame(height: previewFormat.size.height * (260 / previewFormat.size.width))
        .animation(.easeInOut(duration: 0.2), value: previewFormat)
    }

    private func action(_ title: String, _ icon: String, filled: Bool = false,
                        _ run: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); run() } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 15, weight: .semibold))
                Text(title).font(.cfSans(15, weight: .semibold))
            }
            .foregroundStyle(filled ? Theme.emberCream : Theme.parchment)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                filled ? AnyView(Capsule().fill(Theme.ember))
                       : AnyView(Capsule().stroke(Theme.parchmentFaint, lineWidth: 1)))
        }
    }

    // MARK: Actions

    private func shareStory() {
        UIPasteboard.general.string = content.url.absoluteString
        copied = true
        present(format: .story, items: { img in [img] })
    }

    private func sharePost() {
        present(format: .post, items: { img in [img] })
    }

    private func shareDM() {
        // Link first so Instagram Direct threads it as a tappable link.
        present(format: .post, items: { img in [content.url, img] })
    }

    private func present(format: ShareFormat, items: (UIImage) -> [Any]) {
        guard let img = ShareRenderer.render(content, format: format) else { return }
        share = SharePayload(items: items(img))
    }

    private func loadCover() async {
        defer { loadingCover = false }
        guard let raw = allocation.night?.photoUrls?.first,
              let url = URL(string: raw) else { return }
        if let (data, _) = try? await URLSession.shared.data(from: url),
           let img = UIImage(data: data) {
            cover = img
        }
    }
}

private struct SharePayload: Identifiable {
    let id = UUID()
    let items: [Any]
}

/// UIActivityViewController bridge — the system share sheet (Instagram Stories,
/// Instagram, Direct, Messages, etc. appear here when installed).
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
