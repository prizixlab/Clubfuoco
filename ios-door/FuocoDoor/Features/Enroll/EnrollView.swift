import SwiftUI

/// Device enrollment (§6 auth — simpler enrolled-device path for v1). Staff enter
/// a venue enrollment code; the device gets a revocable credential bound to that
/// venue. The 12h lock means a lost device stops being useful within half a day.
struct EnrollView: View {
    var onEnrolled: (DeviceSession) -> Void
    private let repo = RepoFactory.make()

    @State private var code = ""
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Theme.night.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                VStack(spacing: 10) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 48)).foregroundStyle(Theme.gold)
                    Text("Fuoco Door").font(.cfSerif(38)).foregroundStyle(Theme.parchment)
                    Text("Enroll this device to a venue to start scanning tonight's door.")
                        .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                }

                VStack(spacing: 12) {
                    TextField("", text: $code, prompt: Text("Enrollment code").foregroundColor(Theme.parchmentFaint))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.cfMono(18))
                        .foregroundStyle(Theme.parchment)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 16)
                        .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.nightLift))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))

                    if let error {
                        Text(error).font(.cfMono(12)).foregroundStyle(Theme.deny)
                            .multilineTextAlignment(.center)
                    }

                    EmberPillButton(title: "Enroll device", loading: loading) { enroll() }
                }
                .padding(.horizontal, 32)

                if RepoFactory.useMock {
                    Text("Demo build — any code works. Try DOOR-1.")
                        .font(.cfMono(11)).foregroundStyle(Theme.flame.opacity(0.7))
                }
                Spacer()
            }
        }
        .preferredColorScheme(.dark)
    }

    private func enroll() {
        loading = true; error = nil
        Task {
            do {
                let r = try await repo.enroll(code: code)
                let s = DeviceSession(deviceToken: r.deviceToken, venue: r.venue,
                                      venueName: r.venueName, enrolledAt: Date())
                s.save()
                Haptics.success()
                onEnrolled(s)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Enrollment failed."
                Haptics.error()
            }
            loading = false
        }
    }
}
