import { describe, it, expect } from 'vitest'
import { shownSuppliers, toggleSupplier, type Rule } from './conflict-rule'

const A = 'aashi', R = 'rumba', T = 'third'
const ALL = [A, R]

describe('shownSuppliers', () => {
  it("'all' shows every supplier", () => {
    expect(shownSuppliers({ mode: 'all', brand_ids: [] }, ALL)).toEqual(ALL)
  })
  it("'none' shows nobody", () => {
    expect(shownSuppliers({ mode: 'none', brand_ids: [] }, ALL)).toEqual([])
  })
  it("'selected' shows exactly the set", () => {
    expect(shownSuppliers({ mode: 'selected', brand_ids: [R] }, ALL)).toEqual([R])
  })
  it("ignores a stale brand_ids when mode is not 'selected'", () => {
    // The regression: a set left over from another mode must not leak through.
    expect(shownSuppliers({ mode: 'none', brand_ids: ALL }, ALL)).toEqual([])
  })
})

describe('toggleSupplier', () => {
  it('turns one ON from none — not everyone else', () => {
    const shown = shownSuppliers({ mode: 'none', brand_ids: [] }, ALL)
    expect(toggleSupplier(shown, A)).toEqual({ mode: 'selected', brand_ids: [A] })
  })

  it('accepts many at once', () => {
    let rule: Rule = { mode: 'none', brand_ids: [] }
    for (const id of [A, R, T]) {
      rule = toggleSupplier(shownSuppliers(rule, [A, R, T]), id)
    }
    expect(rule.mode).toBe('selected')
    expect(rule.brand_ids.slice().sort()).toEqual([A, R, T].slice().sort())
  })

  it('turns one OFF from all, leaving the rest on', () => {
    const shown = shownSuppliers({ mode: 'all', brand_ids: [] }, ALL)
    expect(toggleSupplier(shown, A)).toEqual({ mode: 'selected', brand_ids: [R] })
  })

  it('adds to an existing selection', () => {
    const shown = shownSuppliers({ mode: 'selected', brand_ids: [R] }, ALL)
    expect(toggleSupplier(shown, A)).toEqual({ mode: 'selected', brand_ids: [R, A] })
  })

  it("collapses to 'none' when the last box is cleared", () => {
    const shown = shownSuppliers({ mode: 'selected', brand_ids: [A] }, ALL)
    expect(toggleSupplier(shown, A)).toEqual({ mode: 'none', brand_ids: [] })
  })

  it('a click always flips the box that was displayed', () => {
    // The invariant the bug broke, over every starting mode.
    for (const mode of ['all', 'none', 'selected'] as const) {
      const rule: Rule = { mode, brand_ids: mode === 'selected' ? [R] : ALL }
      const shown = shownSuppliers(rule, ALL)
      for (const id of ALL) {
        const was = shown.includes(id)
        const next = toggleSupplier(shown, id)
        expect(next.brand_ids.includes(id)).toBe(!was)
      }
    }
  })
})
