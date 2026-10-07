import SwiftUI

/// Native port of WhenPlanner — collapsible "when are you going out?" pill.
/// Collapsed: a pill showing the resolved plan ("Tonight"). Expanded: a wheel
/// picker over today → +14 days.
struct WhenPlannerView: View {
    @Environment(PlanStore.self) private var plan
    @Environment(LocaleStore.self) private var locale
    @State private var open = false
    /// What the wheel is on. Spinning only moves this; `plan.date` (which
    /// rebuilds the whole feed) is set once, after the wheel has closed —
    /// a rebuild per wheel stop made the wheel and Done feel sluggish.
    @State private var draft: String?

    var body: some View {
        let options = PlanStore.dayOptions(locale: locale)
        let shown = draft ?? plan.date

        VStack(spacing: 0) {
            Button {
                Haptics.tap()
                if open { close() } else {
                    draft = plan.date
                    withAnimation(.snappy(duration: 0.25)) { open = true }
                }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "calendar")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.accent)
                    Text(locale.t("plan.goingOut").uppercased())
                        .font(.cfSans(9.5))
                        .kerning(1)
                        .foregroundStyle(Theme.fadedSand)
                        .lineLimit(1)
                    Text(options.first { $0.value == shown }?.label ?? shown)
                        .font(.cfSerif(17, italic: true))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.stone)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
            }

            if open {
                VStack(spacing: 8) {
                    Divider().overlay(Theme.hairline)

                    Picker(locale.t("plan.day"), selection: Binding(
                        get: { draft ?? plan.date },
                        set: { draft = $0 }
                    )) {
                        ForEach(options) { option in
                            Text(option.label)
                                .font(.cfSerif(20))
                                .tag(option.value)
                        }
                    }
                    .pickerStyle(.wheel)
                    .frame(height: 140)
                    .clipped()

                    Button {
                        Haptics.tap()
                        close()
                    } label: {
                        Text(locale.t("plan.done"))
                            .font(.cfSans(13, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 42)
                            .background(Theme.ink, in: .rect(cornerRadius: 12))
                            .foregroundStyle(Theme.cream)
                    }
                    .padding([.horizontal, .bottom], 14)
                }
            }
        }
        .background(
            open ? Theme.surface : Theme.ink.opacity(0.05),
            in: .rect(cornerRadius: Theme.radiusField)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusField)
                .stroke(open ? Theme.hairline : .clear)
        )
        .padding(.horizontal, 20)
        // Leaving Explore with the wheel open still keeps the night picked.
        .onDisappear { commit() }
    }

    /// Collapse first, then commit: the feed rebuild lands after the
    /// animation instead of stalling it.
    private func close() {
        withAnimation(.snappy(duration: 0.25)) {
            open = false
        } completion: {
            commit()
        }
    }

    private func commit() {
        if let draft, draft != plan.date { plan.date = draft }
        draft = nil
    }
}
