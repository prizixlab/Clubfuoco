import SwiftUI

/// The secured-scanning door code, shown to the promoter who owns the event.
///
/// This is the thing they read out to a bouncer over WhatsApp, so it is set in
/// mono at a size that survives a photo of a phone screen, and it copies with
/// one tap. The alphabet has no O/0 or I/L/1, so there is nothing to spell out.
///
/// Rotating revokes every door holding the old code, which is the whole point
/// of rotating — and also the whole danger, since doing it at 1am locks out the
/// people currently working. Hence the live-door count sitting next to the
/// button rather than buried in a confirmation.
struct EventCodeCard: View {
    let nightId: UUID

    @State private var code: String?
    @State private var activeDoors = 0
    @State private var loading = true
    @State private var working = false
    @State private var error: String?
    @State private var copied = false
    @State private var confirmingRotate = false

    private let repo = PromoterRepo()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "lock.shield").font(.system(size: 13)).foregroundStyle(Theme.gold)
                Kicker("Door code", color: Theme.gold)
            }

            if loading {
                ProgressView().tint(Theme.parchment)
            } else if let code {
                codeBlock(code)
            } else {
                Text("No code yet. Nobody can scan this door until there is one.")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
                Button { Task { await create() } } label: {
                    Label(working ? "Creating…" : "Create door code", systemImage: "key.horizontal")
                        .font(.cfSans(14, weight: .semibold)).foregroundStyle(Theme.gold)
                }
                .disabled(working)
            }

            if let error {
                Text(error).font(.cfSans(12)).foregroundStyle(Theme.wine)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.nightLift))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.hairline))
        .task { await load() }
        .confirmationDialog(
            activeDoors > 0
                ? "\(activeDoors) scanner\(activeDoors == 1 ? "" : "s") \(activeDoors == 1 ? "is" : "are") using the current code. Rotating signs \(activeDoors == 1 ? "it" : "them") out immediately."
                : "Rotating replaces the code. Anyone holding the old one stops being able to scan.",
            isPresented: $confirmingRotate, titleVisibility: .visible
        ) {
            Button("Rotate code", role: .destructive) { Task { await rotate() } }
            Button("Keep it", role: .cancel) { }
        }
    }

    private func codeBlock(_ code: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                UIPasteboard.general.string = code
                Haptics.success()
                copied = true
                Task {
                    try? await Task.sleep(nanoseconds: 1_600_000_000)
                    copied = false
                }
            } label: {
                HStack {
                    Text(code)
                        .font(.cfMono(30)).kerning(6)
                        .foregroundStyle(Theme.parchment)
                    Spacer()
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 15))
                        .foregroundStyle(copied ? Theme.gold : Theme.parchmentDim)
                }
            }

            Text("Give this to whoever works the door. In Fuoco Door: **Working a secured door? Enter its code**.")
                .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)

            HStack(spacing: 14) {
                if activeDoors > 0 {
                    HStack(spacing: 5) {
                        Circle().fill(Theme.gold).frame(width: 6, height: 6)
                        Text("\(activeDoors) scanner\(activeDoors == 1 ? "" : "s") connected")
                            .font(.cfMono(11)).foregroundStyle(Theme.parchmentDim)
                    }
                }
                Spacer()
                Button { confirmingRotate = true } label: {
                    Label(working ? "Rotating…" : "Rotate", systemImage: "arrow.triangle.2.circlepath")
                        .font(.cfSans(13, weight: .semibold)).foregroundStyle(Theme.flame)
                }
                .disabled(working)
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let c = try await repo.eventCode(nightId: nightId)
            code = c.code
            activeDoors = c.activeDoors ?? 0
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func create() async { await mutate(rotate: false) }
    private func rotate() async { await mutate(rotate: true) }

    private func mutate(rotate: Bool) async {
        working = true; error = nil
        defer { working = false }
        do {
            code = try await repo.setEventCode(nightId: nightId, rotate: rotate)
            // Every previous session was just revoked, so the count is zero
            // until doors re-enter the new code.
            if rotate { activeDoors = 0 }
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
        }
    }
}
