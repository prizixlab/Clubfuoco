import SwiftUI
import UIKit

/// Per-employee referral links. The promoter adds a staff member, gets a link
/// to hand them; guests who claim through it are attributed to that employee,
/// and the promoter sees each one's headcount here.
struct StaffLinksCard: View {
    @ObservedObject var model: GuestlistModel
    let allocationId: UUID?
    let seriesId: UUID?

    @State private var adding = false
    @State private var newName = ""
    @State private var shareURL: ShareURL?

    private static let base = "https://clubfuoco.com/i/"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Kicker("Staff links")
                Spacer()
                Button {
                    Haptics.tap(); adding = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.emberCream)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(Theme.ember))
                }
            }

            if model.referrals.isEmpty {
                Text("Give each employee their own link — you'll see how many each one brings.")
                    .font(.cfSans(12)).foregroundStyle(Theme.parchmentDim)
            } else {
                VStack(spacing: 0) {
                    ForEach(model.referrals) { r in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.label).font(.cfSerif(18)).foregroundStyle(Theme.parchment)
                                Text("\(model.count(forReferral: r.id)) brought")
                                    .font(.cfMono(10)).kerning(1).foregroundStyle(Theme.flame)
                            }
                            Spacer()
                            Button {
                                UIPasteboard.general.string = Self.base + r.token
                                Haptics.success()
                            } label: {
                                Image(systemName: "doc.on.doc").font(.system(size: 13))
                                    .foregroundStyle(Theme.parchment)
                                    .frame(width: 30, height: 30)
                                    .background(Circle().stroke(Theme.parchmentFaint))
                            }
                            Button {
                                shareURL = ShareURL(url: URL(string: Self.base + r.token)!)
                            } label: {
                                Image(systemName: "square.and.arrow.up").font(.system(size: 13))
                                    .foregroundStyle(Theme.emberCream)
                                    .frame(width: 30, height: 30)
                                    .background(Circle().fill(Theme.ember))
                            }
                        }
                        .padding(.vertical, 12)
                        Divider().background(Theme.hairline)
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.radiusCard).fill(Theme.nightLift))
        .alert("Add staff member", isPresented: $adding) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) { newName = "" }
            Button("Create link") {
                let name = newName.trimmingCharacters(in: .whitespaces)
                newName = ""
                guard !name.isEmpty else { return }
                Task { await model.addReferral(label: name, allocationId: allocationId, seriesId: seriesId) }
            }
        } message: {
            Text("They'll get their own invite link. Guests they bring are tracked under their name.")
        }
        .sheet(item: $shareURL) { wrapped in
            ShareSheet(items: ["Your Fuoco guestlist link:", wrapped.url])
                .presentationDetents([.medium])
        }
    }
}

private struct ShareURL: Identifiable { let url: URL; var id: String { url.absoluteString } }
