import SwiftUI

/// Recent admissions/voids this session (§3). Left-swipe an admit row to reveal
/// the same slide-to-void track used on the result screen.
struct RecentScansView: View {
    @ObservedObject var store: DoorStore
    @ObservedObject var controller: ScanController
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                if store.recent().isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "clock").font(.system(size: 34)).foregroundStyle(Theme.parchmentFaint)
                        Text("No scans yet tonight").font(.cfSans(15)).foregroundStyle(Theme.parchmentDim)
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 10) {
                            ForEach(store.recent()) { rec in
                                RecentRow(rec: rec) { controller.voidRecord(rec) }
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("Recent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.flame)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct RecentRow: View {
    let rec: QueuedScan
    var onVoid: () -> Void
    @State private var revealed = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: rec.action == .void ? "arrow.uturn.backward" : rec.kind.icon)
                    .font(.system(size: 16))
                    .foregroundStyle(rec.action == .void ? Theme.wine : Theme.gold)
                    .frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(rec.holderName).font(.cfSans(15, weight: .medium)).foregroundStyle(Theme.parchment)
                    Text("\(rec.action == .void ? "Void" : "Admit") · \(rec.kind.label) · \(rec.count) · \(rec.deviceTime.formatted(date: .omitted, time: .shortened))")
                        .font(.cfMono(11)).foregroundStyle(Theme.parchmentDim)
                }
                Spacer()
                if !rec.synced {
                    Circle().fill(Theme.flame).frame(width: 6, height: 6)
                }
                if rec.action == .admit {
                    Button {
                        withAnimation(.spring(response: 0.3)) { revealed.toggle() }
                    } label: {
                        Image(systemName: revealed ? "chevron.up" : "chevron.left")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.parchmentDim)
                    }
                }
            }
            if revealed && rec.action == .admit {
                SwipeToVoid(label: "Slide to void this \(rec.kind.label.lowercased())") {
                    onVoid()
                    withAnimation { revealed = false }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
    }
}
