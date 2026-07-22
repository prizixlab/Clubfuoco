import SwiftUI

// Shown after a promoter or supplier submits something queued for review — a
// guestlist night, a recurring series, or an offer change. Sets the
// expectation: reviewed as soon as possible, live only once approved.
//
// Deliberately no fixed turnaround. A stated "3 business days" is a promise
// the queue has to keep, and a promoter whose Friday night is still pending on
// Thursday has been told they can wait. "As soon as we can" is honest at this
// volume and can be tightened into a real SLA later.
struct ReviewSubmittedScreen: View {
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            ZStack {
                Circle().fill(Theme.ember.opacity(0.15)).frame(width: 92, height: 92)
                Image(systemName: "clock.badge.checkmark")
                    .font(.system(size: 40)).foregroundStyle(Theme.ember)
            }
            Text("Submitted for review")
                .font(.cfSerif(28)).foregroundStyle(Theme.parchment)
                .multilineTextAlignment(.center)
            Text("Club Fuoco will review and approve this **as soon as possible**. It goes live — and your invite link starts working — once approved.")
                .font(.cfSans(14)).foregroundStyle(Theme.parchmentDim)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 34)
            Spacer()
            Button { Haptics.tap(); onDone() } label: {
                Text("Done")
                    .font(.cfSans(15, weight: .semibold)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity).frame(height: 52)
                    .background(Theme.ember, in: .rect(cornerRadius: 12))
            }
            .padding(.horizontal, 22).padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.night.ignoresSafeArea())
    }
}
