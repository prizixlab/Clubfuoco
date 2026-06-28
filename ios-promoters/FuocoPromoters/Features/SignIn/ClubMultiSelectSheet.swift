import SwiftUI

/// Searchable multi-select list of Barcelona clubs, plus a free-text "Other"
/// field for venues/scenes not in the list.
struct ClubMultiSelectSheet: View {
    let clubs: [Club]
    @Binding var selected: Set<UUID>
    @Binding var other: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var otherFocused: Bool

    private var filtered: [Club] {
        guard !query.isEmpty else { return clubs }
        return clubs.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.night.ignoresSafeArea()
                VStack(spacing: 0) {
                    // Search
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Theme.parchmentDim)
                        TextField("", text: $query,
                                  prompt: Text("Search clubs…").foregroundStyle(Theme.parchmentDim))
                            .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: Theme.radiusField).fill(Theme.parchment.opacity(0.06)))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusField).stroke(Theme.hairline))
                    .padding(.horizontal, 20).padding(.top, 12)

                    List {
                        ForEach(filtered) { c in
                            Button {
                                Haptics.tap()
                                if selected.contains(c.id) { selected.remove(c.id) } else { selected.insert(c.id) }
                            } label: {
                                HStack {
                                    Text(c.name).font(.cfSerif(20)).foregroundStyle(Theme.parchment)
                                    Spacer()
                                    Image(systemName: selected.contains(c.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selected.contains(c.id) ? Theme.ember : Theme.parchmentFaint)
                                        .font(.system(size: 20))
                                }
                                .padding(.vertical, 6)
                            }
                            .listRowBackground(Theme.night)
                            .listRowSeparatorTint(Theme.hairline)
                        }

                        // Other — free text
                        Section {
                            VStack(alignment: .leading, spacing: 6) {
                                Kicker("Other (not listed)")
                                TextField("", text: $other,
                                          prompt: Text("Add venues or scenes, comma-separated")
                                            .foregroundStyle(Theme.parchmentDim))
                                    .font(.cfSans(15)).foregroundStyle(Theme.parchment)
                                    .focused($otherFocused)
                                    .padding(.vertical, 8)
                                    .overlay(alignment: .bottom) { Rectangle().fill(Theme.parchmentFaint).frame(height: 1) }
                            }
                            .padding(.vertical, 4)
                            .listRowBackground(Theme.night)
                            .listRowSeparator(.hidden)
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Theme.night)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.night, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Clubs you work").font(.cfMono(11, weight: .medium)).kerning(2).foregroundStyle(Theme.flame)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.ember).font(.cfSans(15, weight: .semibold))
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Button("Done") { otherFocused = false }.foregroundStyle(Theme.ember); Spacer()
                }
            }
        }
    }
}
