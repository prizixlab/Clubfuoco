import SwiftUI

/// The scan → access screen (§2). Big verdict band, holder, live counter, a
/// per-head admit stepper, and — once admitted — a slide-to-void track (§3).
struct AccessResultView: View {
    let descriptor: AccessDescriptor
    let liveUsed: Int
    @ObservedObject var controller: ScanController
    var onDone: () -> Void

    @State private var entering: Int = 1

    private var verdict: (text: String, color: Color, icon: String) {
        switch descriptor.status {
        case .ok:          return ("ADMIT", Theme.admit, "checkmark.circle.fill")
        case .over:        return ("OVER", Theme.over, "exclamationmark.triangle.fill")
        case .alreadyUsed: return ("ALREADY USED", Theme.over, "clock.badge.exclamationmark")
        case .cancelled:   return ("CANCELLED", Theme.deny, "xmark.octagon.fill")
        case .invalid:     return ("INVALID", Theme.deny, "xmark.octagon.fill")
        case .wrongNight:  return ("WRONG NIGHT", Theme.deny, "calendar.badge.exclamationmark")
        }
    }

    private var justRecorded: Bool { controller.lastRecordedScanId != nil }
    private var remaining: Int { max(0, descriptor.allowance.allowed - liveUsed) }

    var body: some View {
        VStack(spacing: 0) {
            band
            ScrollView {
                VStack(spacing: 20) {
                    holder
                    counter
                    if descriptor.status.admits && !justRecorded { admitControls }
                    if justRecorded { recordedState }
                    if !descriptor.status.admits { denyNote }
                }
                .padding(20)
            }
        }
        .background(Theme.night.ignoresSafeArea())
        .presentationDetents([.large])
    }

    // MARK: Verdict band
    private var band: some View {
        VStack(spacing: 8) {
            Image(systemName: verdict.icon).font(.system(size: 44, weight: .bold))
            Text(verdict.text).font(.cfSans(34, weight: .bold)).tracking(1)
            // What kind of credential this is — the door needs to know whether
            // it's a paid entry, a VIP table or a free guestlist spot at a
            // glance. Suppressed for unknown codes, where `kind` is a default
            // rather than something we actually resolved.
            if descriptor.status != .invalid {
                HStack(spacing: 6) {
                    Image(systemName: descriptor.kind.icon)
                        .font(.system(size: 11, weight: .semibold))
                    Text(descriptor.kind.label.uppercased())
                        .font(.cfMono(12, weight: .medium))
                        .kerning(1.6)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Capsule().fill(Color.black.opacity(0.22)))
            }
        }
        .foregroundStyle(Theme.emberCream)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 34)
        .background(verdict.color)
    }

    // MARK: Holder
    private var holder: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(Theme.nightLift)
                Image(systemName: descriptor.kind.icon)
                    .font(.system(size: 22)).foregroundStyle(Theme.gold)
            }
            .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(descriptor.holderName)
                    .font(.cfSerif(26)).foregroundStyle(Theme.parchment)
                Text(descriptor.entitlement.label)
                    .font(.cfSans(13)).foregroundStyle(Theme.parchmentDim)
                if !descriptor.entitlement.extras.isEmpty {
                    Text(descriptor.entitlement.extras.joined(separator: " · "))
                        .font(.cfMono(11)).foregroundStyle(Theme.flame)
                }
            }
            Spacer()
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    // MARK: Counter
    private var counter: some View {
        HStack {
            Kicker("Admitted")
            Spacer()
            Text("\(liveUsed) ")
                .font(.cfMono(30, weight: .medium))
                .foregroundStyle(liveUsed > descriptor.allowance.allowed ? Theme.over : Theme.parchment)
            + Text("of \(descriptor.allowance.allowed)")
                .font(.cfMono(30, weight: .medium))
                .foregroundColor(Theme.parchmentDim)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }

    // MARK: Admit controls (per-head stepper)
    private var admitControls: some View {
        VStack(spacing: 16) {
            HStack {
                Text("Entering now").font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                Spacer()
                stepper
            }
            EmberPillButton(title: "Admit \(entering)", trailingIcon: "arrow.right") {
                controller.admit(descriptor, count: entering)
            }
            if descriptor.status == .over {
                Text("Over allowance — admitting adds to the overscan count.")
                    .font(.cfMono(11)).foregroundStyle(Theme.over)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }

    private var stepper: some View {
        HStack(spacing: 18) {
            stepButton("minus") { if entering > 1 { entering -= 1; Haptics.tap() } }
            Text("\(entering)").font(.cfMono(24, weight: .medium))
                .foregroundStyle(Theme.parchment).frame(minWidth: 34)
            stepButton("plus") { entering += 1; Haptics.tap() }
        }
    }
    private func stepButton(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold))
                .foregroundStyle(Theme.parchment)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Theme.nightLift).overlay(Circle().stroke(Theme.hairline)))
        }
    }

    // MARK: Recorded state → swipe to void + done
    private var recordedState: some View {
        VStack(spacing: 16) {
            // Name the credential being voided — the bouncer should know what
            // they're reversing before they commit the swipe.
            Label("Recorded · \(descriptor.kind.label)", systemImage: "checkmark.seal.fill")
                .font(.cfSans(15, weight: .semibold)).foregroundStyle(Theme.admitBright)
            SwipeToVoid(label: "Slide to void this \(descriptor.kind.label.lowercased())") {
                if let id = controller.lastRecordedScanId {
                    controller.void(scanId: id, desc: descriptor)
                }
                onDone()
            }
            Button("Done") { onDone() }
                .font(.cfSans(15, weight: .semibold)).foregroundStyle(Theme.parchmentDim)
        }
    }

    private var denyNote: some View {
        VStack(spacing: 12) {
            Text("Do not admit.").font(.cfSerif(22)).foregroundStyle(Theme.deny)
            Button("Dismiss") { onDone() }
                .font(.cfSans(15, weight: .semibold)).foregroundStyle(Theme.parchmentDim)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }
}
