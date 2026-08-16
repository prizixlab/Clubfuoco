import { describe, it, expect } from 'vitest'
import { resolvePassTheme, HOUSE_THEME, type PassThemeRow } from './pass-theme'

const row = (over: Partial<PassThemeRow> = {}): PassThemeRow => ({ ...HOUSE_THEME, ...over })

describe('resolvePassTheme', () => {
  // The literal values that were hardcoded in the invite pass route before
  // themes existed. If this test ever fails, every existing guest's pass just
  // changed colour without anyone asking for it.
  it('reproduces the pre-theme pass exactly for an unthemed promoter', () => {
    const t = resolvePassTheme(HOUSE_THEME)
    expect(t.backgroundColor).toBe('rgb(10, 8, 7)')
    expect(t.labelColor).toBe('rgb(232, 182, 91)')
    expect(t.foregroundColor).toBe('rgb(255, 246, 229)')
    expect(t.isHouse).toBe(true)
  })

  it('applies a custom pair and derives the value colour to match', () => {
    const t = resolvePassTheme(row({ background: '#FFFFFF', accent: '#7A5C10' }))
    expect(t.backgroundColor).toBe('rgb(255, 255, 255)')
    expect(t.labelColor).toBe('rgb(122, 92, 16)')
    expect(t.foregroundColor).toBe('rgb(10, 8, 7)')   // ink, not cream
    expect(t.isHouse).toBe(false)
  })

  it('falls back to the house look for a blocked theme', () => {
    const t = resolvePassTheme(row({
      background: '#FF00FF', accent: '#00FF00', status: 'blocked',
    }))
    expect(t.backgroundColor).toBe('rgb(10, 8, 7)')
    expect(t.isHouse).toBe(true)
  })

  it('keeps a theme that is merely awaiting review', () => {
    // under_review is not a punishment — the pass stays branded while a human
    // looks, because a guestlist is time-sensitive and the door still works.
    const t = resolvePassTheme(row({ background: '#101820', status: 'under_review' }))
    expect(t.backgroundColor).toBe('rgb(16, 24, 32)')
    expect(t.isHouse).toBe(false)
  })

  it('falls back rather than throwing on a pair that no longer validates', () => {
    // Storage is validated on write, so this should be unreachable — but a
    // pass that cannot be generated is a guest stuck at a door.
    const t = resolvePassTheme(row({ background: '#1A1614', accent: '#1B1715' }))
    expect(t.backgroundColor).toBe('rgb(10, 8, 7)')
    expect(t.isHouse).toBe(true)
  })

  it('falls back on garbage in the colour columns', () => {
    const t = resolvePassTheme(row({ background: 'chartreuse', accent: '' }))
    expect(t.backgroundColor).toBe('rgb(10, 8, 7)')
    expect(t.foregroundColor).toBe('rgb(255, 246, 229)')
    expect(t.isHouse).toBe(true)
  })

  describe('logoText', () => {
    it('is used when there is no logo image', () => {
      expect(resolvePassTheme(row({ logo_text: 'NOIR' })).logoText).toBe('NOIR')
    })

    it('is dropped when a logo image is present, so PassKit draws one wordmark', () => {
      const t = resolvePassTheme(row({
        logo_text: 'NOIR',
        logo_1x_url: 'https://example.test/logo.png',
      }))
      expect(t.logoText).toBeNull()
    })

    it('treats whitespace as absent', () => {
      expect(resolvePassTheme(row({ logo_text: '   ' })).logoText).toBeNull()
    })
  })
})
