// Legibility rules for a promoter-branded Wallet pass.
//
// This pass gets read by a bouncer, at night, on someone else's phone, in a
// hurry. A promoter who picks charcoal on black ships a pass that fails at the
// door and never finds out, because they only ever see it on a bright screen
// indoors. So the colour pair is validated rather than trusted, and the value
// colour is derived rather than chosen — for a given background there is
// exactly one legible answer, and offering the choice only lets someone pick
// wrong.
//
// Ratios are WCAG 2.1 relative luminance. The thresholds are WCAG AA for
// normal text (4.5:1) and for large/secondary text (3:1); pass field labels are
// small caps and sit closer to the latter.

export type Rgb = { r: number; g: number; b: number }

/** Minimum contrast for field VALUES — the guest name, the date, the venue. */
export const VALUE_MIN_RATIO = 4.5
/** Minimum contrast for field LABELS, which are smaller and less critical. */
export const LABEL_MIN_RATIO = 3

// The two candidate value colours. Not pure white/black: these are the house
// ink and cream, so a default theme renders byte-for-byte the pass we shipped
// before themes existed.
export const INK: Rgb = { r: 10, g: 8, b: 7 }        // #0A0807
export const CREAM: Rgb = { r: 255, g: 246, b: 229 } // #FFF6E5

/** Parse "#RGB" or "#RRGGBB" (case-insensitive). null when malformed. */
export function parseHex(hex: string): Rgb | null {
  const s = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{3}$/i.test(s) && !/^[0-9a-f]{6}$/i.test(s)) return null
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** "#RRGGBB", upper case — the storage form. */
export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

/** "rgb(r, g, b)" — the only colour form PassKit accepts in pass.json. */
export function toPassColor({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1 … 21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The value colour for a background: house cream or house ink, whichever reads
 * better. Never a promoter's choice.
 */
export function readableForeground(background: Rgb): Rgb {
  return contrastRatio(CREAM, background) >= contrastRatio(INK, background) ? CREAM : INK
}

export type ThemeCheck = {
  ok: boolean
  /** Derived, never chosen. */
  foreground: Rgb
  /** foreground against background. */
  valueRatio: number
  /** accent against background. */
  labelRatio: number
  /** Empty when ok. One human sentence per failing pair. */
  problems: string[]
}

/**
 * Check a promoter's colour pair and derive the value colour.
 *
 * `valueRatio` can only fail for a background that is mid-grey enough to beat
 * both cream and ink — a narrow band, but a real one, and exactly the band a
 * promoter reaches for when they want "a nice muted brand colour".
 */
export function checkTheme(background: Rgb, accent: Rgb): ThemeCheck {
  const foreground = readableForeground(background)
  const valueRatio = contrastRatio(foreground, background)
  const labelRatio = contrastRatio(accent, background)
  const problems: string[] = []

  if (valueRatio < VALUE_MIN_RATIO) {
    problems.push(
      `This background is too mid-toned for text to read against — neither light nor dark type clears the ${VALUE_MIN_RATIO}:1 minimum (best is ${valueRatio.toFixed(1)}:1). Go lighter or darker.`
    )
  }
  if (labelRatio < LABEL_MIN_RATIO) {
    problems.push(
      `The accent is too close to the background to read as a label (${labelRatio.toFixed(1)}:1, needs ${LABEL_MIN_RATIO}:1).`
    )
  }

  return { ok: problems.length === 0, foreground, valueRatio, labelRatio, problems }
}

/** Hex-string convenience wrapper. Malformed input is a failure, not a throw. */
export function checkThemeHex(
  background: string,
  accent: string
): ThemeCheck & { backgroundRgb: Rgb | null; accentRgb: Rgb | null } {
  const bg = parseHex(background)
  const ac = parseHex(accent)
  if (!bg || !ac) {
    const problems: string[] = []
    if (!bg) problems.push('Background must be a hex colour like #0A0807.')
    if (!ac) problems.push('Accent must be a hex colour like #E8B65B.')
    return {
      ok: false, foreground: CREAM, valueRatio: 0, labelRatio: 0, problems,
      backgroundRgb: bg, accentRgb: ac,
    }
  }
  return { ...checkTheme(bg, ac), backgroundRgb: bg, accentRgb: ac }
}
