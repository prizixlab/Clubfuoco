import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkTheme, readableForeground, CREAM, type Rgb } from './contrast'

// The Wallet pass legibility rule exists twice:
//
//   src/lib/wallet/contrast.ts                     server — rejects the write
//   ios-promoters/…/You/PassContrastMath.swift     app    — blocks the Save button
//
// They must agree. If they drift, a promoter gets a Save button that does
// nothing: the app says the colour pair is fine, the server 422s it, and
// nobody finds out until someone complains.
//
// So this COMPILES AND RUNS the shipped Swift file — not a transcription of it
// — over the same cases and diffs the answers. Skipped without a Swift
// toolchain, so it does not break a non-Mac CI run.

const SWIFT_FILE = path.resolve(
  __dirname, '../../../ios-promoters/FuocoPromoters/Features/You/PassContrastMath.swift'
)

function hasSwift(): boolean {
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' })
    return existsSync(SWIFT_FILE)
  } catch {
    return false
  }
}

function buildCases(): [Rgb, Rgb][] {
  const cases: [Rgb, Rgb][] = []
  const rgb = (r: number, g: number, b: number): Rgb => ({
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
  })

  // Greys — this is where the unusable mid band lives, so it is where the two
  // implementations are most likely to disagree about which value colour wins.
  for (let v = 0; v <= 255; v += 3) cases.push([rgb(v, v, v), rgb(255, 255, 255)])
  for (let v = 0; v <= 255; v += 7) cases.push([rgb(v, v, v), rgb(v + 10, v, v - 10)])

  // The house palette and every preset the app ships.
  const known: [number[], number[]][] = [
    [[10, 8, 7], [232, 182, 91]],       // house
    [[16, 24, 32], [143, 184, 222]],    // Ink
    [[42, 14, 18], [226, 161, 111]],    // Oxblood
    [[244, 239, 230], [140, 42, 42]],   // Bone
    [[15, 30, 24], [201, 180, 88]],     // Forest
    [[255, 255, 255], [0, 0, 0]],
    [[0, 0, 0], [255, 255, 255]],
    [[118, 118, 118], [255, 255, 255]], // inside the unusable band
  ]
  for (const [bg, ac] of known) cases.push([rgb(bg[0], bg[1], bg[2]), rgb(ac[0], ac[1], ac[2])])

  // A hue sweep, so a per-channel weighting typo cannot hide.
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51)
        cases.push([rgb(r, g, b), rgb(255 - r, 255 - g, 255 - b)])

  return cases
}

const HARNESS = `
let raw = CommandLine.arguments[1]
let cases = raw.split(separator: ";").map { pair -> (PassContrastMath.RGB, PassContrastMath.RGB) in
    let sides = pair.split(separator: "|")
    let a = sides[0].split(separator: ",").map { Double($0)! }
    let b = sides[1].split(separator: ",").map { Double($0)! }
    return (PassContrastMath.RGB(a[0], a[1], a[2]), PassContrastMath.RGB(b[0], b[1], b[2]))
}
var out: [String] = []
for (bg, ac) in cases {
    let c = PassContrastMath.check(background: bg, accent: ac)
    let fg = c.foreground == PassContrastMath.cream ? "cream" : "ink"
    out.append("\\(fg),\\(c.valueRatio),\\(c.labelRatio),\\(c.ok)")
}
print(out.joined(separator: ";"))
`

describe.skipIf(!hasSwift())('contrast.ts ↔ PassContrastMath.swift parity', () => {
  it('agrees on every case: value colour, both ratios, and the verdict', () => {
    const cases = buildCases()
    const dir = mkdtempSync(path.join(tmpdir(), 'pass-contrast-'))
    try {
      const harness = path.join(dir, 'main.swift')
      const bin = path.join(dir, 'harness')
      writeFileSync(harness, HARNESS)
      execFileSync('swiftc', ['-O', SWIFT_FILE, harness, '-o', bin], { stdio: 'pipe' })

      const arg = cases
        .map(([bg, ac]) => `${bg.r},${bg.g},${bg.b}|${ac.r},${ac.g},${ac.b}`)
        .join(';')
      const rows = execFileSync(bin, [arg], { maxBuffer: 64 * 1024 * 1024 })
        .toString().trim().split(';')

      expect(rows).toHaveLength(cases.length)

      const mismatches: string[] = []
      cases.forEach(([bg, ac], i) => {
        const ts = checkTheme(bg, ac)
        const tsFg = readableForeground(bg) === CREAM ? 'cream' : 'ink'
        const [fg, value, label, ok] = rows[i].split(',')

        const same =
          fg === tsFg &&
          (ok === 'true') === ts.ok &&
          Math.abs(Number(value) - ts.valueRatio) < 1e-9 &&
          Math.abs(Number(label) - ts.labelRatio) < 1e-9

        if (!same) {
          mismatches.push(
            `bg=${bg.r},${bg.g},${bg.b} accent=${ac.r},${ac.g},${ac.b}\n` +
            `  ts   : fg=${tsFg} value=${ts.valueRatio} label=${ts.labelRatio} ok=${ts.ok}\n` +
            `  swift: fg=${fg} value=${value} label=${label} ok=${ok}`
          )
        }
      })

      expect(mismatches.slice(0, 5).join('\n')).toBe('')
      expect(mismatches).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
