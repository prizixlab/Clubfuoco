import SwiftUI

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

    @State private var loaded = false
    @State private var saving = false
    @State private var savedTheme: PassTheme?
    @State private var serverError: String?
    @State private var justSaved = false

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
        PassContrast.check(background: background, accent: accent)
    }

    private var dirty: Bool {
        guard let s = savedTheme else { return false }
        return background.hexString != s.background.uppercased()
            || accent.hexString != s.accent.uppercased()
            || wordmark.trimmingCharacters(in: .whitespaces) != (s.logoText ?? "")
    }

    private var canSave: Bool { loaded && check.ok && dirty && !saving }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                preview
                legibility
                colours
                wordmarkField
                actions
                footnote
            }
            .padding(20)
            .padding(.bottom, 40)
        }
        .background(Theme.night.ignoresSafeArea())
        .navigationTitle("Wallet pass")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.night, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await load() }
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
                    Text(wordmarkDisplay)
                        .font(.cfSerif(19))
                        .foregroundStyle(foreground)
                        .lineLimit(1)
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

    private var wordmarkDisplay: String {
        let t = wordmark.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "Club Fuoco" : t
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

    // MARK: - Wordmark

    private var wordmarkField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker("Wordmark", color: Theme.parchmentDim)
            TextField("", text: $wordmark, prompt:
                Text("Your name on the pass").foregroundStyle(Theme.parchmentDim))
                .font(.cfSans(15))
                .foregroundStyle(Theme.parchment)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(Theme.nightLift, in: .rect(cornerRadius: Theme.radiusField))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
                .onChange(of: wordmark) { _, new in
                    // PassKit puts this on one line beside the logo and
                    // silently truncates a long one on-device, which reads as
                    // a bug rather than a limit. Stop it at the source.
                    if new.count > 24 { wordmark = String(new.prefix(24)) }
                }
            Text("Leave blank to show Club Fuoco. Max 24 characters.")
                .font(.cfSans(11.5))
                .foregroundStyle(Theme.parchmentDim)
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
    }

    private func load() async {
        guard !loaded else { return }
        // A load failure leaves the house defaults on screen, which is what an
        // unthemed promoter has anyway — better than an empty screen.
        if let theme = try? await repo.load() { apply(theme) }
        else { savedTheme = .house }
        loaded = true
    }

    private func save() async {
        saving = true; serverError = nil
        defer { saving = false }
        do {
            let t = wordmark.trimmingCharacters(in: .whitespaces)
            let theme = try await repo.save(
                background: background.hexString,
                accent: accent.hexString,
                logoText: t.isEmpty ? nil : t)
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
