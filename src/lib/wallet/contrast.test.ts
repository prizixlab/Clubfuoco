import { describe, it, expect } from 'vitest'
import {
  parseHex, toHex, toPassColor, relativeLuminance, contrastRatio,
  readableForeground, checkTheme, checkThemeHex,
  INK, CREAM, VALUE_MIN_RATIO, LABEL_MIN_RATIO,
} from './contrast'

describe('parseHex', () => {
  it('parses 6-digit hex', () => {
    expect(parseHex('#0A0807')).toEqual({ r: 10, g: 8, b: 7 })
    expect(parseHex('#E8B65B')).toEqual({ r: 232, g: 182, b: 91 })
  })

  it('parses 3-digit shorthand by doubling each nibble', () => {
    expect(parseHex('#FFF')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('#0AF')).toEqual({ r: 0, g: 170, b: 255 })
  })

  it('is case-insensitive and tolerates a missing hash or stray spaces', () => {
    expect(parseHex('e8b65b')).toEqual({ r: 232, g: 182, b: 91 })
    expect(parseHex('  #E8b65B  ')).toEqual({ r: 232, g: 182, b: 91 })
  })

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', 'rgb(1,2,3)', '#GGGGGG', 'gold']) {
      expect(parseHex(bad), bad).toBeNull()
    }
  })
})

describe('serialisation', () => {
  it('round-trips through hex', () => {
    expect(toHex(parseHex('#E8B65B')!)).toBe('#E8B65B')
  })

  it('upper-cases and zero-pads', () => {
    expect(toHex({ r: 0, g: 8, b: 7 })).toBe('#000807')
  })

  it('clamps out-of-range channels rather than emitting invalid hex', () => {
    expect(toHex({ r: -20, g: 300, b: 7 })).toBe('#00FF07')
  })

  it('emits the only colour form pass.json accepts', () => {
    expect(toPassColor({ r: 10, g: 8, b: 7 })).toBe('rgb(10, 8, 7)')
  })
})

describe('relativeLuminance', () => {
  it('anchors at the WCAG endpoints', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })

  it('weights green above red above blue', () => {
    const red   = relativeLuminance({ r: 255, g: 0, b: 0 })
    const green = relativeLuminance({ r: 0, g: 255, b: 0 })
    const blue  = relativeLuminance({ r: 0, g: 0, b: 255 })
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5)
  })

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio({ r: 40, g: 90, b: 120 }, { r: 40, g: 90, b: 120 })).toBeCloseTo(1, 5)
  })

  it('does not depend on argument order', () => {
    const a = { r: 232, g: 182, b: 91 }
    const b = { r: 10, g: 8, b: 7 }
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })
})

describe('readableForeground', () => {
  it('picks cream on a dark background', () => {
    expect(readableForeground({ r: 10, g: 8, b: 7 })).toEqual(CREAM)
  })

  it('picks ink on a light background', () => {
    expect(readableForeground({ r: 250, g: 248, b: 245 })).toEqual(INK)
  })

  it('only ever returns one of the two house colours', () => {
    for (let v = 0; v <= 255; v += 5) {
      const got = readableForeground({ r: v, g: v, b: v })
      expect(got === INK || got === CREAM, `grey ${v}`).toBe(true)
    }
  })

  it('always returns whichever of the two actually reads better', () => {
    for (let v = 0; v <= 255; v += 5) {
      const bg = { r: v, g: v, b: v }
      const got = readableForeground(bg)
      expect(contrastRatio(got, bg)).toBeGreaterThanOrEqual(
        Math.min(contrastRatio(INK, bg), contrastRatio(CREAM, bg))
      )
      expect(contrastRatio(got, bg)).toBeCloseTo(
        Math.max(contrastRatio(INK, bg), contrastRatio(CREAM, bg)), 10
      )
    }
  })
})

describe('checkTheme', () => {
  // The values that were hardcoded in the invite pass route before themes
  // existed. A default theme must reproduce that pass exactly.
  it('accepts the house palette and derives the cream it already shipped', () => {
    const r = checkTheme(parseHex('#0A0807')!, parseHex('#E8B65B')!)
    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
    expect(toPassColor(r.foreground)).toBe('rgb(255, 246, 229)')
    expect(r.valueRatio).toBeGreaterThan(VALUE_MIN_RATIO)
    expect(r.labelRatio).toBeGreaterThan(LABEL_MIN_RATIO)
  })

  it('rejects an accent that vanishes into its background', () => {
    // Near-black accent on near-black ground — the failure the promoter will
    // never see indoors and the door will always see.
    const r = checkTheme(parseHex('#0A0807')!, parseHex('#1A1614')!)
    expect(r.ok).toBe(false)
    expect(r.labelRatio).toBeLessThan(LABEL_MIN_RATIO)
    expect(r.problems.join(' ')).toMatch(/accent/i)
  })

  it('rejects a mid-grey background that beats both cream and ink', () => {
    const r = checkTheme(parseHex('#767676')!, parseHex('#FFFFFF')!)
    expect(r.ok).toBe(false)
    expect(r.valueRatio).toBeLessThan(VALUE_MIN_RATIO)
    expect(r.problems.join(' ')).toMatch(/lighter or darker/i)
  })

  it('reports both problems at once rather than one at a time', () => {
    // #767676 is inside the narrow band where neither cream nor ink clears
    // 4.5:1, and the accent sits right next to it.
    const r = checkTheme(parseHex('#767676')!, parseHex('#6E6E6E')!)
    expect(r.ok).toBe(false)
    expect(r.problems).toHaveLength(2)
  })

  it('the unusable-background band is narrow and mid-toned, not a wide hole', () => {
    // Worth pinning: if this band ever widened, ordinary dark brand colours
    // would start being rejected and the feature would feel broken.
    const failing: number[] = []
    for (let v = 0; v <= 255; v++) {
      const bg = { r: v, g: v, b: v }
      if (checkTheme(bg, { r: 255, g: 255, b: 255 }).valueRatio < VALUE_MIN_RATIO) failing.push(v)
    }
    expect(failing.length).toBeLessThan(60)
    expect(Math.min(...failing)).toBeGreaterThan(90)
    expect(Math.max(...failing)).toBeLessThan(165)
    // And it is contiguous — one band, not scattered holes.
    expect(Math.max(...failing) - Math.min(...failing) + 1).toBe(failing.length)
  })

  it('accepts a light theme, flipping the value colour to ink', () => {
    const r = checkTheme(parseHex('#FFFFFF')!, parseHex('#7A5C10')!)
    expect(r.ok).toBe(true)
    expect(r.foreground).toEqual(INK)
  })

  it('quotes the measured ratio in the message, so the number is actionable', () => {
    const r = checkTheme(parseHex('#0A0807')!, parseHex('#1A1614')!)
    expect(r.problems[0]).toMatch(/\d\.\d:1/)
  })
})

describe('checkThemeHex', () => {
  it('treats malformed input as a failure, never a throw', () => {
    const r = checkThemeHex('not-a-colour', '#E8B65B')
    expect(r.ok).toBe(false)
    expect(r.backgroundRgb).toBeNull()
    expect(r.accentRgb).toEqual({ r: 232, g: 182, b: 91 })
    expect(r.problems.join(' ')).toMatch(/Background must be a hex colour/)
  })

  it('names both fields when both are malformed', () => {
    const r = checkThemeHex('', 'rgb(1,2,3)')
    expect(r.problems).toHaveLength(2)
  })

  it('passes valid input straight through to checkTheme', () => {
    expect(checkThemeHex('#0A0807', '#E8B65B').ok).toBe(true)
  })
})
