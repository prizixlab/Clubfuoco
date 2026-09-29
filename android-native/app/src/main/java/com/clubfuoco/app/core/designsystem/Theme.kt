package com.clubfuoco.app.core.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.clubfuoco.app.R

/**
 * Design tokens — a direct port of ios-native's `Theme.swift`, which in turn
 * lifted them from the web app's palette. The two files must stay in step;
 * change one, change the other.
 *
 * The iOS version leans on `Color.adaptive(light:dark:)`, a dynamic UIColor
 * that resolves per trait collection so ~850 call sites need no branching.
 * Compose has no equivalent, so the same trick is done with a palette object
 * chosen once at the top of the tree and read through a CompositionLocal:
 * `Theme.ink` still means "the right ink for the current appearance" at every
 * call site, and nothing downstream has to know which mode is active.
 */
data class FuocoPalette(
    // `ink` and `cream` are a contrast PAIR: ink is the primary text colour and
    // also the fill of primary buttons/pills, whose labels are always cream.
    // Because both invert together, those filled controls flip to light-on-dark
    // in dark mode with no call-site change.
    val ink: Color,
    val stone: Color,
    val sand: Color,
    val fadedSand: Color,
    val cream: Color,
    val gold: Color,
    val wine: Color,
    /**
     * Wine's *decorative* half — venue names, "6 venues →" links, section
     * icons, stat numbers. On the cream page it is the same red; against
     * near-black a page full of red reads as noise, so it goes off-white and
     * lets the type carry the hierarchy.
     *
     * Keep [wine] itself for red that MEANS something: errors, destructive
     * actions, badges. Those stay red in both modes.
     */
    val accent: Color,
    val hairline: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val imagePlaceholder: Color,
    val success: Color,
    val ember: Color,
    val flame: Color,
)

private val LightPalette = FuocoPalette(
    ink = Color(0xFF221E1A),
    stone = Color(0xFF6E6356),
    sand = Color(0xFFB0A898),
    fadedSand = Color(0xFF9F9486),
    cream = Color(0xFFF8F5EE),
    gold = Color(0xFFC09950),
    wine = Color(0xFF8C2A2A),
    accent = Color(0xFF8C2A2A),
    hairline = Color(0x1A221E1A),
    surface = Color(0xFFFFFFFF),
    surfaceRaised = Color(0xFFFFFFFF),
    imagePlaceholder = Color(0xFFEFE9DD),
    success = Color(0xFF2D7A46),
    ember = Color(0xFFC2562D),
    flame = Color(0xFFE8B65B),
)

// Saturation, not hue, is what makes the golds read as gold. A near-pure hue
// looks like paint at any lightness — yellow up around 44°, orange down at 35° —
// and chasing it by moving hue just trades one for the other. The brand's light
// gold sits at S .58, and that muting is the whole trick, so the dark variants
// hold hue ~41° and match the saturation, taking the deepening in value alone.
private val DarkPalette = FuocoPalette(
    ink = Color(0xFFEDE6D8),
    stone = Color(0xFFB4AA9A),
    sand = Color(0xFF7A7264),
    fadedSand = Color(0xFF8A8172),
    cream = Color(0xFF0E0C0A),
    gold = Color(0xFFAD8A45),
    // The first dark wine lifted brightness without saturation and came out
    // coral. #B33F38 holds the red hue at S .69 instead of .60 and drops
    // V .78 → .70, so it reads as wine again.
    wine = Color(0xFFB33F38),
    accent = Color(0xFFE8E0D2),
    hairline = Color(0x1FF4ECDD),
    surface = Color(0xFF1A1613),
    surfaceRaised = Color(0xFF232019),
    imagePlaceholder = Color(0xFF231F1A),
    success = Color(0xFF4CA96B),
    // Saturation up rather than value down, so it lands bolder instead of
    // muddy — an orange that still has bite against the near-black page.
    ember = Color(0xFFB8431A),
    flame = Color(0xFFC7A150),
)

/**
 * Fixed colours — deliberately NOT adaptive, because the surface they sit on is
 * dark (or must stay light) in both appearances.
 */
object FuocoFixed {
    /** Splash + cinema hero surfaces. */
    val night = Color(0xFF0A0807)
    val parchment = Color(0xFFF4ECDD)
    val emberCream = Color(0xFFFFF6E5)
    val darkRed = Color(0xFF6B1F1F)

    /**
     * QR cards stay white with dark modules in BOTH modes — door scanners need
     * the quiet zone, so these must never follow the appearance.
     */
    val qrSurface = Color.White
    val onQrSurface = Color(0xFF221E1A)

    /**
     * The rating star over photo cards. Sits on a scrim over a photo, which is
     * dark either way, so it is fixed at H40 / S.63 — gold rather than the
     * highlighter-yellow it used to be.
     */
    val starGold = Color(0xFFE0B052)
}

object FuocoRadius {
    val field = 14.dp
    val card = 18.dp
    val pill = 24.dp
}

// ── Typography ───────────────────────────────────────────────────────────────
// The brand fonts, matching the web and iOS apps exactly: Instrument Serif
// (display) + Geist Sans (body) + Geist Mono (kickers/labels), copied from
// ios-native/ClubFuoco/Fonts into res/font.
//
// Geist ships Medium/SemiBold/Bold as separate files, which Compose models as
// weights inside one family — cleaner than iOS, where they are separate
// families referenced by PostScript name.

val InstrumentSerif = FontFamily(
    Font(R.font.instrumentserif_regular, FontWeight.Normal),
    Font(R.font.instrumentserif_italic, FontWeight.Normal, FontStyle.Italic),
)

val Geist = FontFamily(
    Font(R.font.geist_regular, FontWeight.Normal),
    Font(R.font.geist_medium, FontWeight.Medium),
    Font(R.font.geist_semibold, FontWeight.SemiBold),
    Font(R.font.geist_bold, FontWeight.Bold),
)

val GeistMono = FontFamily(
    Font(R.font.geistmono_regular, FontWeight.Normal),
    Font(R.font.geistmono_medium, FontWeight.Medium),
)

private val LocalFuocoPalette = staticCompositionLocalOf { LightPalette }

/**
 * The app's palette at the current appearance. Named `Theme` so ported Swift
 * reads almost unchanged: `Theme.ink` here is `Theme.ink` there.
 */
object Theme {
    val colors: FuocoPalette
        @Composable @ReadOnlyComposable get() = LocalFuocoPalette.current

    val ink: Color @Composable @ReadOnlyComposable get() = colors.ink
    val stone: Color @Composable @ReadOnlyComposable get() = colors.stone
    val sand: Color @Composable @ReadOnlyComposable get() = colors.sand
    val fadedSand: Color @Composable @ReadOnlyComposable get() = colors.fadedSand
    val cream: Color @Composable @ReadOnlyComposable get() = colors.cream
    val gold: Color @Composable @ReadOnlyComposable get() = colors.gold
    val wine: Color @Composable @ReadOnlyComposable get() = colors.wine
    val accent: Color @Composable @ReadOnlyComposable get() = colors.accent
    val hairline: Color @Composable @ReadOnlyComposable get() = colors.hairline
    val surface: Color @Composable @ReadOnlyComposable get() = colors.surface
    val surfaceRaised: Color @Composable @ReadOnlyComposable get() = colors.surfaceRaised
    val imagePlaceholder: Color @Composable @ReadOnlyComposable get() = colors.imagePlaceholder
    val success: Color @Composable @ReadOnlyComposable get() = colors.success
    val ember: Color @Composable @ReadOnlyComposable get() = colors.ember
    val flame: Color @Composable @ReadOnlyComposable get() = colors.flame
}

/**
 * Root theme wrapper. [dark] is passed explicitly (rather than always reading
 * the system) because appearance is user-controlled in Settings — Light / Dark /
 * System — exactly as `ThemeStore` drives `preferredColorScheme` on iOS.
 */
@Composable
fun ClubFuocoTheme(
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalFuocoPalette provides if (dark) DarkPalette else LightPalette,
        content = content,
    )
}
