import SwiftUI
import PhotosUI

/// What produces the mark at the top of the pass.
enum LogoMode: String, CaseIterable, Identifiable {
    case none, text, image
    var id: String { rawValue }
    var label: String {
        switch self {
        case .none:  return "None"
        case .text:  return "Wordmark"
        case .image: return "Image"
        }
    }
}

// Settings → Brand → Wallet pass.
//
// Brand the Apple Wallet pass a promoter's guests receive. The preview is the
// point of the screen: nobody can reason about a colour pair in the abstract,
// and this pass gets read by a bouncer, at night, on someone else's phone.
//
// The pass is always signed with Club Fuoco's Pass Type ID certificate — there
// is only one, and a promoter cannot supply their own without their own Apple
// Developer membership. What they control is everything the guest sees.

struct PassThemeView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var background = Color(hex: 0x0A0807)
    @State private var accent     = Color(hex: 0xE8B65B)
    @State private var wordmark   = ""

    @State private var logoMode: LogoMode = .none
    @State private var logoFont  = PassLogoRenderer.defaultFace.id
    @State private var logoColor = Color(hex: 0xFFF6E5)
    /// The image the promoter picked this session, or the saved one fetched
    /// back. Also what the preview draws, so preview and upload cannot diverge.
    @State private var logoImage: UIImage?
    @State private var logoItem: PhotosPickerItem?
    @State private var uploadingLogo = false
    /// Set when the picked image or the wordmark typography changed, so Save
    /// knows it has bitmaps to re-render and re-upload.
    @State private var logoDirty = false

    @State private var loaded = false
    @State private var saving = false
    @State private var savedTheme: PassTheme?
    @State private var serverError: String?
    @State private var justSaved = false
    /// The wordmark field is the only thing on this screen that takes the
    /// keyboard, and the keyboard covers the preview — which is the whole
    /// point of the screen. So it has to be easy to put away.
    @FocusState private var wordmarkFocused: Bool

    private let repo = PassThemeRepo()

    /// Known-good pairings. Most promoters want "black and gold, but mine" and
    /// should not have to solve a contrast problem to get there.
    private static let presets: [(name: String, bg: UInt32, accent: UInt32)] = [
        ("House",   0x0A0807, 0xE8B65B),
        ("Ink",     0x101820, 0x8FB8DE),
        ("Oxblood", 0x2A0E12, 0xE2A16F),
        ("Bone",    0xF4EFE6, 0x8C2A2A),
        ("Forest",  0x0F1E18, 0xC9B458),
    ]

    private var check: PassContrast.Check {
        // The wordmark colour only matters when a wordmark is being typeset.
        PassContrast.check(background: background, accent: accent,
                           logo: logoMode == .text ? logoColor : nil)
    }

    private var dirty: Bool {
        guard let s = savedTheme else { return false }
        return background.hexString != s.background.uppercased()
            || accent.hexString != s.accent.uppercased()
            || wordmark.trimmingCharacters(in: .whitespaces) != (s.logoText ?? "")
            || logoMode.rawValue != (s.logoMode ?? "none")
            || logoFont != (s.logoFont ?? PassLogoRenderer.defaultFace.id)
            || logoColor.hexString != (s.logoColor ?? "#FFF6E5").uppercased()
            || logoDirty
    }

    private var canSave: Bool {
        guard loaded, check.ok, dirty, !saving, !uploadingLogo else { return false }
        // Nothing to typeset / nothing to upload is not a saveable state.
        if logoMode == .text  { return !wordmark.trimmingCharacters(in: .whitespaces).isEmpty }
        if logoMode == .image { return logoImage != nil }
        return true
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                preview
                legibility
                colours
                logoSection
                actions
                footnote
            }
            .padding(20)
            .padding(.bottom, 40)
        }
        // Drag the page and the keyboard goes with it, tracking the gesture —
        // the gesture you already make to get back to the preview.
        .scrollDismissesKeyboard(.interactively)
        // And a tap anywhere puts it away. Simultaneous rather than a plain
        // onTapGesture: a tap gesture owned by the ScrollView would compete
        // with the preset buttons and colour pickers inside it, and this way
        // both fire — tapping a preset dismisses the keyboard AND picks it.
        .simultaneousGesture(TapGesture().onEnded { wordmarkFocused = false })
        .background(Theme.night.ignoresSafeArea())
        .navigationTitle("Wallet pass")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.night, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            // The explicit exit, for anyone who does not think to tap away.
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { wordmarkFocused = false }
                    .font(.cfSans(15, weight: .semibold))
                    .foregroundStyle(Theme.gold)
            }
        }
        .task { await load() }
        .onChange(of: logoItem) { _, item in Task { await adopt(item) } }
        // Changing the face or the ink means the stored bitmaps no longer match
        // what is on screen, so Save has to re-render them.
        .onChange(of: logoFont)  { _, _ in if logoMode == .text { logoDirty = true } }
        .onChange(of: logoColor) { _, _ in if logoMode == .text { logoDirty = true } }
        .onChange(of: wordmark)  { _, _ in if logoMode == .text { logoDirty = true } }
        .animation(.easeInOut(duration: 0.18), value: check.ok)
    }

    // MARK: - Preview

    /// A facsimile of the eventTicket layout the invite pass uses, in the
    /// promoter's own colours. Sample data is deliberately realistic — a long
    /// guest name is the case that actually breaks a pass layout.
    private var preview: some View {
        VStack(alignment: .leading, spacing: 0) {
            Kicker("Preview", color: Theme.parchmentDim)
                .padding(.bottom, 10)

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    previewMark
                    Spacer(minLength: 8)
                    Text("GUESTLIST")
                        .font(.cfMono(8)).kerning(1.3)
                        .foregroundStyle(accent)
                }
                .padding(.bottom, 18)

                passField("GUEST", "Alexandra Moreno-Quintana", big: true)
                    .padding(.bottom, 16)

                HStack(alignment: .top, spacing: 18) {
                    passField("VENUE", "Sala Apolo")
                    passField("DATE", "Friday 21 August")
                }
                .padding(.bottom, 14)

                HStack(alignment: .top, spacing: 18) {
                    passField("GUESTS", "2")
                    passField("HOURS", "23:59 – 06:30")
                    Spacer(minLength: 0)
                }
                .padding(.bottom, 18)

                // The barcode is ours and is not themeable — it has to scan.
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white)
                    .frame(width: 92, height: 92)
                    .overlay(
                        Image(systemName: "qrcode")
                            .font(.system(size: 62))
                            .foregroundStyle(.black)
                    )
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .padding(18)
            .background(background, in: .rect(cornerRadius: Theme.radiusCard))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusCard)
                    .stroke(Theme.parchmentFaint)
            )
        }
    }

    private var foreground: Color { check.foreground }

    /// The pass's logo area, drawn the way the bundle will carry it: the
    /// wordmark in its real face and colour, or the image at its real aspect,
    /// inside the same 160×50pt box the renderer targets.
    @ViewBuilder private var previewMark: some View {
        switch logoMode {
        case .text:
            Text(wordmarkDisplay)
                .font(PassLogoRenderer.font(logoFont, size: 21))
                .foregroundStyle(logoColor)
                .lineLimit(1)
                .minimumScaleFactor(0.4)
                .frame(maxWidth: 160, maxHeight: 50, alignment: .leading)
        case .image:
            if let img = logoImage {
                Image(uiImage: img)
                    .resizable().scaledToFit()
                    .frame(maxWidth: 160, maxHeight: 50, alignment: .leading)
            } else {
                Text("No image chosen")
                    .font(.cfSans(12))
                    .foregroundStyle(foreground.opacity(0.5))
            }
        case .none:
            // What an unbranded pass actually shows: our mark.
            Text("Club Fuoco")
                .font(.cfSerif(19))
                .foregroundStyle(foreground)
                .lineLimit(1)
        }
    }

    private var wordmarkDisplay: String {
        let t = wordmark.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "Your name" : t
    }

    private func passField(_ label: String, _ value: String, big: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.cfMono(8)).kerning(1.2)
                .foregroundStyle(accent)
            Text(value)
                .font(big ? .cfSans(19, weight: .semibold) : .cfSans(13, weight: .medium))
                .foregroundStyle(foreground)
                .lineLimit(big ? 2 : 1)
                .minimumScaleFactor(0.7)
        }
    }

    // MARK: - Legibility

    @ViewBuilder private var legibility: some View {
        if check.ok {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.flame)
                Text(String(format: "Readable — text %.1f:1, labels %.1f:1",
                            check.valueRatio, check.labelRatio))
                    .font(.cfSans(12))
                    .foregroundStyle(Theme.parchmentDim)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(check.problems, id: \.self) { problem in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Theme.wine)
                        Text(problem)
                            .font(.cfSans(12.5))
                            .foregroundStyle(Theme.parchment)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Text("Your guests show this at a dark door. Saving is blocked until it reads.")
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.parchmentDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .background(Theme.wine.opacity(0.14), in: .rect(cornerRadius: Theme.radiusField))
        }
    }

    // MARK: - Colours

    private var colours: some View {
        VStack(alignment: .leading, spacing: 16) {
            Kicker("Colours", color: Theme.parchmentDim)

            ColorPicker(selection: $background, supportsOpacity: false) {
                pickerLabel("Background", "The surface of the pass")
            }
            ColorPicker(selection: $accent, supportsOpacity: false) {
                pickerLabel("Accent", "Field labels — GUEST, VENUE, DATE")
            }

            // The value colour is derived, not offered: for a given background
            // there is exactly one legible answer.
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 5)
                    .fill(foreground)
                    .frame(width: 22, height: 22)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(Theme.parchmentFaint))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Text colour").font(.cfSans(14)).foregroundStyle(Theme.parchment)
                    Text("Chosen for you, so it always reads")
                        .font(.cfSans(11.5)).foregroundStyle(Theme.parchmentDim)
                }
                Spacer(minLength: 0)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Self.presets, id: \.name) { preset in
                        Button {
                            Haptics.tap()
                            background = Color(hex: preset.bg)
                            accent = Color(hex: preset.accent)
                        } label: {
                            VStack(spacing: 6) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 8).fill(Color(hex: preset.bg))
                                    Circle().fill(Color(hex: preset.accent))
                                        .frame(width: 12, height: 12)
                                }
                                .frame(width: 54, height: 40)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.parchmentFaint))
                                Text(preset.name)
                                    .font(.cfMono(8.5)).kerning(0.6)
                                    .foregroundStyle(Theme.parchmentDim)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func pickerLabel(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.cfSans(14)).foregroundStyle(Theme.parchment)
            Text(sub).font(.cfSans(11.5)).foregroundStyle(Theme.parchmentDim)
        }
    }

    // MARK: - Logo

    /// Wordmark and image are one control, because on a pass they are one
    /// thing: PassKit has no typography fields, so a wordmark with a chosen
    /// face and colour has to become a logo IMAGE. Typing one and uploading one
    /// land in exactly the same slot.
    private var logoSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Kicker("Logo", color: Theme.parchmentDim)

            Picker("", selection: $logoMode) {
                ForEach(LogoMode.allCases) { m in Text(m.label).tag(m) }
            }
            .pickerStyle(.segmented)

            switch logoMode {
            case .none:  noLogoNote
            case .text:  wordmarkControls
            case .image: imageControls
            }
        }
        .animation(.easeInOut(duration: 0.18), value: logoMode)
    }

    private var noLogoNote: some View {
        Text("Guests see the Club Fuoco mark. Pick Wordmark or Image to put your own there.")
            .font(.cfSans(11.5))
            .foregroundStyle(Theme.parchmentDim)
            .fixedSize(horizontal: false, vertical: true)
    }

    // ── Typeset wordmark ──────────────────────────────────────────────────────

    private var wordmarkControls: some View {
        VStack(alignment: .leading, spacing: 14) {
            TextField("", text: $wordmark, prompt:
                Text("Your name on the pass").foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(15))
                .foregroundStyle(Theme.parchment)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .focused($wordmarkFocused)
                // A wordmark is one line, so Return means "done", not newline.
                .submitLabel(.done)
                .onSubmit { wordmarkFocused = false }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(Theme.nightLift, in: .rect(cornerRadius: Theme.radiusField))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
                .onChange(of: wordmark) { _, new in
                    // The logo box is 160×50pt. Longer than this and the
                    // renderer shrinks the type until nobody can read it, so
                    // the limit is enforced where it is visible.
                    if new.count > 24 { wordmark = String(new.prefix(24)) }
                }

            fontPicker

            ColorPicker(selection: $logoColor, supportsOpacity: false) {
                pickerLabel("Wordmark colour", "The type itself")
            }

            Text("We set your wordmark as an image, which is the only way Apple lets a pass carry your own typeface. Max 24 characters.")
                .font(.cfSans(11.5))
                .foregroundStyle(Theme.parchmentDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Each option is set in its own face, at the colour it will actually be
    /// printed in — a font list rendered in one font tells you nothing.
    private var fontPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(PassLogoRenderer.faces) { face in
                    let selected = face.id == logoFont
                    Button {
                        Haptics.tap()
                        logoFont = face.id
                    } label: {
                        VStack(spacing: 6) {
                            Text(wordmarkSample)
                                .font(PassLogoRenderer.font(face.id, size: 19))
                                .foregroundStyle(logoColor)
                                .lineLimit(1)
                                .minimumScaleFactor(0.5)
                                .frame(height: 26)
                            Text(face.label)
                                .font(.cfMono(8.5)).kerning(0.7)
                                .foregroundStyle(selected ? Theme.flame : Theme.parchmentDim)
                        }
                        .frame(width: 104)
                        .padding(.vertical, 12)
                        .background(background, in: .rect(cornerRadius: Theme.radiusField))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusField)
                            .stroke(selected ? Theme.flame : Theme.hairline,
                                    lineWidth: selected ? 2 : 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var wordmarkSample: String {
        let t = wordmark.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "Aa" : t
    }

    // ── Uploaded image ────────────────────────────────────────────────────────

    private var imageControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            PhotosPicker(selection: $logoItem, matching: .images) {
                HStack(spacing: 14) {
                    ZStack {
                        RoundedRectangle(cornerRadius: Theme.radiusField).fill(background)
                        if let img = logoImage {
                            Image(uiImage: img).resizable().scaledToFit().padding(8)
                        } else {
                            Image(systemName: "photo").font(.system(size: 20))
                                .foregroundStyle(Theme.parchmentDim)
                        }
                    }
                    .frame(width: 128, height: 46)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(logoImage == nil ? "Choose an image" : "Replace image")
                            .font(.cfSans(14, weight: .medium))
                            .foregroundStyle(Theme.parchment)
                        Text("PNG with a transparent background works best")
                            .font(.cfSans(11))
                            .foregroundStyle(Theme.parchmentDim)
                    }
                    Spacer(minLength: 0)
                    if uploadingLogo { ProgressView().tint(Theme.parchmentDim) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Text("Shown at its full width — a wide wordmark is not cropped to a square.")
                .font(.cfSans(11.5))
                .foregroundStyle(Theme.parchmentDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Actions

    private var actions: some View {
        VStack(spacing: 12) {
            if let serverError {
                Text(serverError)
                    .font(.cfSans(12.5))
                    .foregroundStyle(Theme.wine)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                Haptics.tap()
                Task { await save() }
            } label: {
                ZStack {
                    if saving { ProgressView().tint(Theme.night) }
                    else { Text(justSaved && !dirty ? "Saved" : "Save").font(.cfSans(15, weight: .semibold)) }
                }
                .foregroundStyle(Theme.night)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(canSave ? Theme.flame : Theme.parchmentFaint,
                            in: .rect(cornerRadius: Theme.radiusPill))
            }
            .buttonStyle(.plain)
            .disabled(!canSave)

            if !(savedTheme?.isHouse ?? true) {
                Button {
                    Haptics.tap()
                    Task { await reset() }
                } label: {
                    Text("Reset to Club Fuoco")
                        .font(.cfSans(13))
                        .foregroundStyle(Theme.parchmentDim)
                }
                .buttonStyle(.plain)
                .disabled(saving)
            }
        }
    }

    private var footnote: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Being straight about this beats a promoter discovering it from a
            // guest: a pass already in someone's Wallet is a static file.
            Text("Applies to passes issued from now on. Passes already in a guest's Wallet keep the look they were issued with.")
                .font(.cfSans(11.5))
                .foregroundStyle(Theme.parchmentDim)
                .fixedSize(horizontal: false, vertical: true)
            if savedTheme?.status == "under_review" {
                Text("Your branding is live and awaiting a routine review.")
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.flame)
            }
            if savedTheme?.status == "blocked" {
                Text("This branding was not approved, so guests currently see the Club Fuoco pass. Contact support.")
                    .font(.cfSans(11.5))
                    .foregroundStyle(Theme.wine)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Data

    private func apply(_ theme: PassTheme) {
        savedTheme = theme
        background = Color(hexString: theme.background) ?? Color(hex: 0x0A0807)
        accent     = Color(hexString: theme.accent)     ?? Color(hex: 0xE8B65B)
        wordmark   = theme.logoText ?? ""
        logoMode   = LogoMode(rawValue: theme.logoMode ?? "none") ?? .none
        logoFont   = theme.logoFont ?? PassLogoRenderer.defaultFace.id
        logoColor  = Color(hexString: theme.logoColor ?? "") ?? Color(hex: 0xFFF6E5)
        logoDirty  = false
    }

    private func load() async {
        guard !loaded else { return }
        // A load failure leaves the house defaults on screen, which is what an
        // unthemed promoter has anyway — better than an empty screen.
        if let theme = try? await repo.load() {
            apply(theme)
            // Pull the stored mark back so the preview shows what guests
            // currently get, not an empty box.
            if theme.logoMode == "image", let raw = theme.logoUrl, let url = URL(string: raw) {
                if let (data, _) = try? await URLSession.shared.data(from: url) {
                    logoImage = UIImage(data: data)
                }
            }
        } else {
            savedTheme = .house
        }
        loaded = true
    }

    /// Pull a picked photo in and downscale it once, here, so everything after
    /// this point works from a bounded image.
    private func adopt(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        uploadingLogo = true
        defer { uploadingLogo = false }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else {
            serverError = "That image could not be read."
            return
        }
        logoImage = image
        logoDirty = true
        serverError = nil
    }

    private func save() async {
        saving = true; serverError = nil
        defer { saving = false }
        do {
            let t = wordmark.trimmingCharacters(in: .whitespaces)
            // Metadata first: it carries the legibility check, so an illegible
            // pair is refused before any bitmap is uploaded.
            var theme = try await repo.save(
                background: background.hexString,
                accent: accent.hexString,
                logoText: t.isEmpty ? nil : t,
                logoMode: logoMode.rawValue,
                logoFont: logoMode == .text ? logoFont : nil,
                logoColor: logoMode == .text ? logoColor.hexString : nil)

            // Then the bitmaps. Rendered at exactly the sizes PassKit wants;
            // the server re-checks every dimension before storing them.
            switch logoMode {
            case .text:
                let images = PassLogoRenderer.renderText(
                    t,
                    face: logoFont,
                    color: UIColor(logoColor),
                    background: UIColor(background))
                if !images.isEmpty { try await repo.uploadLogo(images) }
            case .image:
                if let img = logoImage, logoDirty {
                    let images = PassLogoRenderer.renderImage(img, background: UIColor(background))
                    try await repo.uploadLogo(images)
                }
            case .none:
                try await repo.clearLogo()
            }

            // Re-read so what is on screen is what the server now holds.
            if let fresh = try? await repo.load() { theme = fresh }
            apply(theme)
            justSaved = true
            Haptics.success()
        } catch {
            serverError = error.localizedDescription
            Haptics.error()
        }
    }

    private func reset() async {
        saving = true; serverError = nil
        defer { saving = false }
        do {
            apply(try await repo.reset())
            justSaved = false
            Haptics.success()
        } catch {
            serverError = error.localizedDescription
            Haptics.error()
        }
    }
}
