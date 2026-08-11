import SwiftUI

/// Native port of WhenPlanner — collapsible "when are you going out?" pill.
/// Collapsed: a pill showing the resolved plan ("Tonight"). Expanded: a wheel
/// picker over today → +14 days.
struct WhenPlannerView: View {
    @Environment(PlanStore.self) private var plan
    @Environment(LocaleStore.self) private var locale
    @State private var open = false

    var body: some View {
        @Bindable var plan = plan
        let options = PlanStore.dayOptions(locale: locale)

        VStack(spacing: 0) {
            Button {
                withAnimation(.spring(duration: 0.3)) { open.toggle() }
                Haptics.tap()
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "calendar")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.wine)
                    Text(locale.t("plan.goingOut").uppercased())
                        .font(.cfSans(9.5))
                        .kerning(1)
                        .foregroundStyle(Theme.fadedSand)
                        .lineLimit(1)
                    Text(plan.formatted(locale: locale))
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

                    Picker(locale.t("plan.day"), selection: $plan.date) {
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
                        withAnimation(.spring(duration: 0.3)) { open = false }
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
    }
}
