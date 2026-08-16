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

  describe('isHouse — decides whether the Club Fuoco flame ships', () => {
    it('is true for no stored theme at all', () => {
      expect(resolvePassTheme(HOUSE_THEME).isHouse).toBe(true)
    })

    it('is true for a stored row that holds the house values by VALUE', () => {
      // A promoter who saved and then reset every field back has a row, but it
      // is not a customisation, so the flame comes back.
      expect(resolvePassTheme(row({ background: '#0a0807', accent: '#e8b65b' })).isHouse).toBe(true)
    })

    it('is false once a colour is changed', () => {
      expect(resolvePassTheme(row({ background: '#2A0E12' })).isHouse).toBe(false)
    })

    it('is false once a wordmark is set, even on house colours', () => {
      // The case from the phone: house palette, wordmark "Nova". The flame sat
      // next to their name and read as a co-sign.
      expect(resolvePassTheme(row({ logo_text: 'Nova' })).isHouse).toBe(false)
    })

    it('is false once a logo image is uploaded', () => {
      expect(resolvePassTheme(row({ logo_1x_url: 'https://x.test/l.png' })).isHouse).toBe(false)
    })

    it('is true whenever we fall back, so the fallback is never half-branded', () => {
      expect(resolvePassTheme(row({ background: '#2A0E12', status: 'blocked' })).isHouse).toBe(true)
      expect(resolvePassTheme(row({ background: 'nonsense', logo_text: 'Nova' })).isHouse).toBe(true)
    })
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
