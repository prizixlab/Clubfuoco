import SwiftUI

// Shared building blocks for the auth surfaces — native counterparts of
// AuthField / PrimaryBtn / ProgressBar in the (auth) pages.

/// Labeled white rounded field container (mono uppercase label above).
struct AuthField<Content: View>: View {
    let label: String
    var error: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Kicker(label, color: Theme.fadedSand, size: 9)
            HStack(spacing: 8) {
                content
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 50)
            .background(
                error ? Theme.wine.opacity(0.04) : Color.white,
                in: .rect(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(error ? Theme.wine : Theme.ink.opacity(0.08))
            )
        }
    }
}

/// Wine-red primary CTA with trailing arrow, "Please wait…" while loading.
struct PrimaryButton: View {
    let title: String
    var loading: Bool = false
    var disabled: Bool = false
    var background: Color = Theme.wine
    let action: () -> Void

    @Environment(LocaleStore.self) private var locale

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            HStack(spacing: 8) {
                if loading {
                    Text(locale.t("auth.pleaseWait"))
                        .font(.cfSans(15, weight: .medium))
                } else {
                    Text(title)
                        .font(.cfSans(15, weight: .medium))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 13, weight: .medium))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 55)
            .background(
                background.opacity(disabled && !loading ? 0.3 : loading ? 0.7 : 1),
                in: .rect(cornerRadius: Theme.radiusField)
            )
            .foregroundStyle(Theme.cream)
        }
        .disabled(disabled || loading)
    }
}

/// Thin segmented progress bar (signup wizard).
struct SegmentedProgress: View {
    let step: Int
    let total: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { i in
                Capsule()
                    .fill(i < step ? Theme.wine : Theme.ink.opacity(0.16))
                    .frame(height: 2)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: step)
    }
}

/// Mono uppercase "← BACK" header button.
struct BackChevronButton: View {
    let action: () -> Void
    @Environment(LocaleStore.self) private var locale

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 11, weight: .medium))
                Text(locale.t("auth.back").uppercased())
                    .font(.cfMono(10))
                    .kerning(1.8)
            }
            .foregroundStyle(Theme.stone)
        }
    }
}

/// Inline error message in brand red.
struct FormError: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.cfSans(12))
            .foregroundStyle(Theme.wine)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
