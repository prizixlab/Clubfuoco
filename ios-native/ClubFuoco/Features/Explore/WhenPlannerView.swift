import SwiftUI

/// The day wheel — "when are you going out?".
///
/// Collapsed it is a pill showing the resolved plan ("Tonight"); expanded it is
/// a wheel over today → +14 days, bound to `PlanStore.date`. Styled to the
/// drum in "Club Fuoco Planner.html" (44pt rows, a selection band, fades top
/// and bottom, italic display face on the selected row), re-tinted from that
/// artboard's cream palette to the dark explore palette it now sits in.
///
/// The wheel itself is load-bearing and must stay a wheel: `plan.date` is what
/// the whole feed ranks on — `ShelfBuilder` tiers venues by whether an offer is
/// live on the planned night and whether an event falls on it, and the featured
/// section header prints `plan.nightPhrase()`. Without this control that
/// ranking has no input the user can reach.
struct WhenPlannerView: View {
    @Environment(PlanStore.self) private var plan
    @Environment(LocaleStore.self) private var locale
    @State private var open = false

    /// `.fz-drum__row` height — also the height of the selection band.
    private let rowHeight: CGFloat = 44

    var body: some View {
        @Bindable var plan = plan
        let options = PlanStore.dayOptions(locale: locale)

        VStack(spacing: 0) {
            collapsedBar

            if open {
                VStack(spacing: 0) {
                    Rectangle()
                        .fill(Explore.line)
                        .frame(height: 1)
                        .padding(.bottom, 12)

                    // `.fz-card__label`
                    Text(locale.t("plan.goingOut").uppercased())
                        .font(.cfMono(9.5))
                        .kerning(1.9)
                        .foregroundStyle(Explore.ink3)
                        .padding(.bottom, 2)

                    drum(options: options, selection: $plan.date)

                    // `.fz-card__foot`
                    HStack {
                        Text(plan.formatted(locale: locale))
                            .font(.cfDisplay(20, weight: .bold))
                            .foregroundStyle(Explore.ink)
                            .lineLimit(1)
                        Spacer(minLength: 12)
                        Button {
                            withAnimation(.spring(duration: 0.3)) { open = false }
                            Haptics.tap()
                        } label: {
                            Text(locale.t("plan.done"))
                                .font(.cfSans(14, weight: .semibold))
                                .foregroundStyle(Explore.onAccent)
                                .padding(.horizontal, 22)
                                .padding(.vertical, 11)
                                .background(Explore.accent, in: .capsule)
                        }
                    }
                    .padding(.top, 13)
                    .overlay(alignment: .top) {
                        Rectangle().fill(Explore.line).frame(height: 1)
                    }
                    .padding(.horizontal, 2)
                }
                .padding(.init(top: 0, leading: 16, bottom: 14, trailing: 16))
            }
        }
        .background(open ? Explore.surface : Explore.surface2)
        .clipShape(.rect(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(open ? Explore.lineStrong : Explore.line, lineWidth: 1)
        )
        .padding(.horizontal, Explore.gutter)
    }

    // ── Collapsed pill (.fz-pill) ─────────────────────────────────────────────

    private var collapsedBar: some View {
        Button {
            withAnimation(.spring(duration: 0.3)) { open.toggle() }
            Haptics.tap()
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "calendar")
                    .font(.system(size: 14))
                    .foregroundStyle(Explore.accent)
                Text(locale.t("plan.goingOut").uppercased())
                    .font(.cfMono(9.5))
                    .kerning(1.2)
                    .foregroundStyle(Explore.ink3)
                    .lineLimit(1)
                Text(plan.formatted(locale: locale))
                    .font(.cfDisplay(17))
                    .foregroundStyle(Explore.ink)
                    .lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Explore.ink2)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    // ── Drum (.fz-drum) ───────────────────────────────────────────────────────

    /// The wheel, dressed as the artboard's drum. The band and the fades are
    /// drawn over the Picker rather than by it — UIKit owns the wheel's own
    /// selection chrome, so the overlays sit on top and are not hit-testable.
    private func drum(options: [PlanStore.DayOption], selection: Binding<String>) -> some View {
        Picker(locale.t("plan.day"), selection: selection) {
            ForEach(options) { option in
                Text(option.label)
                    .font(.cfDisplay(20))
                    .foregroundStyle(Explore.ink)
                    .tag(option.value)
            }
        }
        .pickerStyle(.wheel)
        .frame(height: 176)   // four 44pt rows
        .clipped()
        .overlay {
            // `.fz-drums__band` — a hairline above and below the centre row.
            VStack(spacing: 0) {
                Rectangle().fill(Explore.lineStrong).frame(height: 1)
                Spacer()
                Rectangle().fill(Explore.lineStrong).frame(height: 1)
            }
            .frame(height: rowHeight)
            .allowsHitTesting(false)
        }
        .overlay(alignment: .top) { fade(.top) }
        .overlay(alignment: .bottom) { fade(.bottom) }
        // The scroll-touch fix in ExploreView is scoped to the enclosing scroll
        // view precisely so this wheel keeps its own scrollers — a global
        // `UIScrollView.appearance()` version killed them.
    }

    /// `.fz-drums__fade` — surface → transparent, so rows dissolve at the edges
    /// instead of being cut off.
    private func fade(_ edge: VerticalEdge) -> some View {
        LinearGradient(
            stops: [
                .init(color: Explore.surface, location: 0.18),
                .init(color: Explore.surface.opacity(0), location: 1),
            ],
            startPoint: edge == .top ? .top : .bottom,
            endPoint: edge == .top ? .bottom : .top
        )
        .frame(height: 62)
        .allowsHitTesting(false)
    }
}
