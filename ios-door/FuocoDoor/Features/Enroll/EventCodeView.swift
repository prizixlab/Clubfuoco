import SwiftUI

/// Joining a private event with the promoter's six-character code.
///
/// The venue picker can't help here. A private event is usually at a warehouse,
/// a roof, someone's finca — there is no club row to pick, and the server
/// refuses to resolve or admit its guests without a session. So the code is
/// both the credential and the scope: redeeming it stores the night's id where
/// a venue-enrolled door stores its club id, and `ScanController.scoped()`
/// matches a scanned credential's `eventId` against it.
struct EventCodeView: View {
    /// Injected so this shares the picker's repo — a mock in previews or tests
    /// has to reach here too, or the one screen that needs the network is the
    /// one screen that can't be faked.
    var repo: DoorRepo = RepoFactory.make()
    var onJoined: (DeviceSession) -> Void
    var onCancel: (() -> Void)? = nil

    @State private var code = ""
    @State private var loading = false
    @State private var error: String?

    /// The alphabet excludes 0/O and 1/I/L, so a code is exactly six of these.
    private static let allowed = Set("23456789ABCDEFGHJKMNPQRSTUVWXYZ")
    private var cleaned: String { String(code.uppercased().filter(Self.allowed.contains)) }
    private var canSubmit: Bool { cleaned.count == 6 && !loading }

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                VStack(spacing: 10) {
                    Image(systemName: "lock.shield")
                        .font(.system(size: 48)).foregroundStyle(Theme.gold)
                    Text("Secured door").font(.cfSerif(38)).foregroundStyle(Theme.parchment)
                    Text("Enter the event code the promoter gave you to scan this door.")
                        .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                }

                VStack(spacing: 12) {
                    TextField("", text: $code,
                              prompt: Text("Event code").foregroundColor(Theme.parchmentFaint))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.cfMono(26))
                        .kerning(6)
                        .foregroundStyle(Theme.parchment)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 16)
                        .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.nightLift))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
                        // Six characters is the whole code, so stop there rather
                        // than letting someone paste a paragraph into it.
                        .onChange(of: code) { _, _ in
                            let c = cleaned
                            if code != c { code = String(c.prefix(6)) }
                            else if c.count > 6 { code = String(c.prefix(6)) }
                        }

                    if let error {
                        Text(error).font(.cfMono(12)).foregroundStyle(Theme.deny)
                            .multilineTextAlignment(.center)
                    }

                    EmberPillButton(title: "Join event", loading: loading) { join() }
                        .opacity(canSubmit ? 1 : 0.5)
                        .disabled(!canSubmit)

                    if let onCancel {
                        Button("Scan a venue instead", action: onCancel)
                            .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                            .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 32)
                Spacer()
            }
        }
        .preferredColorScheme(.dark)
    }

    private func join() {
        loading = true; error = nil
        Task {
            do {
                let r = try await repo.redeemEventCode(cleaned)
                // `venue` carries the NIGHT id for an event-scoped door — that
                // is what descriptors are matched against.
                let s = DeviceSession(deviceToken: "event", venue: r.nightId,
                                      venueName: r.eventName, enrolledAt: Date(),
                                      eventToken: r.eventToken, eventExpiresAt: r.expiresAt)
                s.save()
                Haptics.success()
                onJoined(s)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription
                    ?? "That event code wasn’t recognised."
                Haptics.error()
            }
            loading = false
        }
    }
}
