import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

// Instagram share graphic for a night's guestlist. One visual language, two
// exports — a 9:16 Story and a 4:5 Feed post — rendered to a flat image with
// ImageRenderer. A scannable QR (+ the printed short URL) carries the invite
// link even on surfaces where Instagram won't make a link tappable.
//
// Design source: Club Fuoco design project — "Instagram Share Template.html".
// Values below are the design's pixel numbers used 1:1 as points; the card is
// rendered at scale 1 so a 1080-pt canvas exports at exactly 1080px.

// MARK: - Palette (from the design; gold matches Theme.gold)

private enum Ink {
    static let deepest    = Color(hex: 0x050403)
    static let gold       = Theme.gold              // #C09950
    static let cream      = Color(hex: 0xEDE6D8)
    static let mutedCream = Color(hex: 0xC9BFAE)
    static let host       = Color(hex: 0x8F8471)
}

// MARK: - Format

enum ShareFormat: String, CaseIterable, Identifiable {
    case story, post
    var id: String { rawValue }
    var label: String { self == .story ? "Story" : "Post" }
    /// Point == pixel canvas, rendered at scale 1.
    var size: CGSize { self == .story ? CGSize(width: 1080, height: 1920)
                                      : CGSize(width: 1080, height: 1350) }
}

// MARK: - Content

struct ShareCardContent {
    var kicker: String = "Free guestlist"
    var title: String
    var venue: String
    var meta: String              // "Sat 26 Jul · doors 23:30"
    var host: String?             // "@handle" or a name — shown as "Hosted by …"
    var url: URL
    var cover: UIImage?           // night cover photo; a warm gradient if nil

    /// "clubfuoco.com/i/ab12cd" — the URL without its scheme, for printing.
    var shortURL: String {
        let host = url.host ?? ""
        return (host + url.path).replacingOccurrences(of: "www.", with: "")
    }

    static func from(allocation: PromoterAllocation,
                     token: String,
                     host: String?,
                     cover: UIImage?) -> ShareCardContent {
        let night = allocation.night
        let url = URL(string: "https://clubfuoco.com/i/\(token)")
            ?? URL(string: "https://clubfuoco.com")!
        return ShareCardContent(
            title: night?.displayTitle ?? "Guestlist",
            venue: night?.venueName ?? "",
            meta: metaLine(night),
            host: host,
            url: url,
            cover: cover)
    }

    private static func metaLine(_ n: PromoterNight?) -> String {
        guard let n else { return "" }
        var parts: [String] = []
        if let d = formatDate(n.nightDate) { parts.append(d) }
        if let door = doorLabel(n) { parts.append("doors \(door)") }
        return parts.joined(separator: " · ")
    }

    private static func formatDate(_ ymd: String) -> String? {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: ymd) else { return nil }
        let out = DateFormatter(); out.dateFormat = "EEE d MMM"
        return out.string(from: d)
    }

    private static func doorLabel(_ n: PromoterNight) -> String? {
        if let t = n.openTime, t.count >= 5 { return String(t.prefix(5)) }  // "HH:mm:ss" → "HH:mm"
        if let d = n.doorsAt {
            let f = DateFormatter(); f.dateFormat = "HH:mm"
            return f.string(from: d)
        }
        return nil
    }
}

// MARK: - QR

enum QRCode {
    /// Dark-on-cream QR from a string, crisp (no interpolation needed by caller).
    static func image(from string: String,
                      dark: UIColor = UIColor(red: 5/255, green: 4/255, blue: 3/255, alpha: 1),
                      light: UIColor = UIColor(red: 237/255, green: 230/255, blue: 216/255, alpha: 1)) -> UIImage? {
        let gen = CIFilter.qrCodeGenerator()
        gen.message = Data(string.utf8)
        gen.correctionLevel = "M"
        guard let base = gen.outputImage else { return nil }

        let fc = CIFilter.falseColor()
        fc.inputImage = base
        fc.color0 = CIColor(color: dark)    // modules
        fc.color1 = CIColor(color: light)   // background
        guard let out = fc.outputImage else { return nil }

        let scaled = out.transformed(by: CGAffineTransform(scaleX: 24, y: 24))
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

// MARK: - Card

struct ShareCardView: View {
    let content: ShareCardContent
    let format: ShareFormat

    var body: some View {
        ZStack {
            background
            switch format {
            case .story: storyContent
            case .post:  postContent
            }
        }
        .frame(width: format.size.width, height: format.size.height)
        .background(Ink.deepest)
        .clipped()
    }

    // Cover photo (or warm gradient) + top/bottom scrims for legibility.
    private var background: some View {
        let scrimTop: CGFloat = format == .story ? 640 : 420
        let scrimBottom: CGFloat = format == .story ? 1000 : 820
        return ZStack {
            Group {
                if let cover = content.cover {
                    Image(uiImage: cover).resizable().scaledToFill()
                } else {
                    LinearGradient(
                        colors: [Color(hex: 0x3A2416), Color(hex: 0x5C2F1C),
                                 Color(hex: 0x8C4A24), Color(hex: 0xC0793F)],
                        startPoint: .topLeading, endPoint: .bottomTrailing)
                }
            }
            .frame(width: format.size.width, height: format.size.height)
            .clipped()

            VStack {
                LinearGradient(colors: [Ink.deepest.opacity(0.92), Ink.deepest.opacity(0)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: scrimTop)
                Spacer()
            }
            VStack {
                Spacer()
                LinearGradient(stops: [
                    .init(color: Ink.deepest.opacity(0.97), location: 0.0),
                    .init(color: Ink.deepest.opacity(0.55), location: 0.55),
                    .init(color: Ink.deepest.opacity(0.0),  location: 1.0),
                ], startPoint: .bottom, endPoint: .top)
                    .frame(height: scrimBottom)
            }
        }
    }

    /// Venue is only worth showing when it isn't just the title again
    /// (many nights are titled after their venue).
    private var showVenue: Bool {
        !content.venue.isEmpty &&
        content.venue.caseInsensitiveCompare(content.title) != .orderedSame
    }

    // MARK: Story (1080×1920)
    //
    // Event info anchored top-left; a big QR card centered at the bottom. The
    // flexible spacer between them pushes the QR down, and the fixed bottom
    // spacer keeps it clear of Instagram's reply bar / link-sticker zone.

    private var storyContent: some View {
        VStack(spacing: 0) {
            eventBlock(wordmark: 26, kicker: 26, title: 112, venue: 40, meta: 30,
                       kickerTop: 44, titleTop: 20, venueTop: 26, metaTop: 16)

            Spacer(minLength: 40)

            qrBlock(qrSize: 440, cardWidth: 520, pad: 34, cap: 30, url: 30, host: 30, gap: 30)

            Spacer(minLength: 0).frame(height: 250)
        }
        .padding(.horizontal, 96)
        .padding(.top, 110)
    }

    // MARK: Post (1080×1350)

    private var postContent: some View {
        VStack(spacing: 0) {
            eventBlock(wordmark: 24, kicker: 24, title: 96, venue: 36, meta: 28,
                       kickerTop: 36, titleTop: 16, venueTop: 22, metaTop: 12)

            Spacer(minLength: 32)

            qrBlock(qrSize: 340, cardWidth: 420, pad: 26, cap: 24, url: 24, host: 24, gap: 22)

            Spacer(minLength: 0).frame(height: 20)
        }
        .padding(.horizontal, 60)
        .padding(.vertical, 60)
    }

    // MARK: Shared pieces

    /// Wordmark + kicker + title + venue + meta, all top-left.
    private func eventBlock(wordmark wm: CGFloat, kicker kk: CGFloat, title tt: CGFloat,
                            venue vn: CGFloat, meta mt: CGFloat,
                            kickerTop: CGFloat, titleTop: CGFloat,
                            venueTop: CGFloat, metaTop: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            wordmark(wm)
            kicker(kk).padding(.top, kickerTop)
            Text(content.title)
                .font(.cfSerif(tt)).foregroundStyle(Ink.cream)
                .lineLimit(2).minimumScaleFactor(0.5)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, titleTop)
            if showVenue {
                Text(content.venue)
                    .font(.cfSerif(vn, italic: true)).foregroundStyle(Ink.mutedCream)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .padding(.top, venueTop)
            }
            if !content.meta.isEmpty {
                Text(content.meta)
                    .font(.cfMono(mt)).tracking(mt * 0.02).foregroundStyle(Ink.mutedCream)
                    .padding(.top, metaTop)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The QR card + host line, centered.
    private func qrBlock(qrSize: CGFloat, cardWidth: CGFloat, pad: CGFloat,
                         cap: CGFloat, url: CGFloat, host: CGFloat, gap: CGFloat) -> some View {
        VStack(spacing: gap) {
            qrCard(qrSize: qrSize, cardWidth: cardWidth, pad: pad, cap: cap, url: url)
            if let h = content.host {
                Text("Hosted by \(h)")
                    .font(.cfMono(host)).tracking(host * 0.03).foregroundStyle(Ink.host)
            }
            // App mention — the invite link is app-only, so point people to it.
            Text("Get in on the Club Fuoco app · App Store")
                .font(.cfMono(host * 0.9, weight: .medium)).tracking(host * 0.04)
                .foregroundStyle(Ink.gold)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Pieces

    private func wordmark(_ size: CGFloat) -> some View {
        Text("CLUB FUOCO")
            .font(.cfMono(size, weight: .medium)).tracking(size * 0.22)
            .foregroundStyle(Ink.cream)
    }

    private func kicker(_ size: CGFloat) -> some View {
        Text(content.kicker.uppercased())
            .font(.cfMono(size, weight: .medium)).tracking(size * 0.06)
            .foregroundStyle(Ink.gold)
    }

    private func qrCard(qrSize: CGFloat, cardWidth: CGFloat?, pad: CGFloat,
                        cap: CGFloat, url: CGFloat) -> some View {
        VStack(spacing: 0) {
            if let qr = QRCode.image(from: content.url.absoluteString) {
                Image(uiImage: qr).interpolation(.none).resizable()
                    .frame(width: qrSize, height: qrSize)
            } else {
                RoundedRectangle(cornerRadius: 6).fill(Ink.deepest.opacity(0.15))
                    .frame(width: qrSize, height: qrSize)
            }
            Text("Scan or tap the link")
                .font(.cfMono(cap, weight: .medium)).tracking(cap * 0.03)
                .foregroundStyle(Ink.deepest)
                .padding(.top, pad * 0.55)
            Text(content.shortURL)
                .font(.cfMono(url, weight: .medium)).tracking(url * 0.03)
                .foregroundStyle(Ink.gold)
                .padding(.top, 4)
        }
        .padding(.horizontal, pad)
        .padding(.top, pad)
        .padding(.bottom, pad * 0.75)
        .frame(width: cardWidth)
        .background(RoundedRectangle(cornerRadius: 16).fill(Ink.cream))
    }
}

// MARK: - Rendering

@MainActor
enum ShareRenderer {
    /// Rasterise a card to a flat image at exact export pixels (scale 1).
    static func render(_ content: ShareCardContent, format: ShareFormat) -> UIImage? {
        let renderer = ImageRenderer(content:
            ShareCardView(content: content, format: format))
        renderer.proposedSize = ProposedViewSize(format.size)
        renderer.scale = 1
        renderer.isOpaque = true
        return renderer.uiImage
    }
}
