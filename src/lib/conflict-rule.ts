// Per-venue supplier rules, as the portal's Conflicts page manipulates them.
//
// 'all' and 'none' are shorthands for a full and an empty set. Keeping a
// separate `picked` array alongside the mode lets the two disagree, which is
// exactly how the first click out of 'all' or 'none' came to invert: `picked`
// was seeded with every supplier while the rows rendered unchecked, so
// clicking one to turn it ON removed it from the set and turned every OTHER
// supplier on instead.
//
// Derive the displayed set from the mode, and toggle against what is
// displayed. Pure so it can be tested without a browser.

export type RuleMode = 'all' | 'none' | 'selected'
export interface Rule { mode: RuleMode; brand_ids: string[] }

/** The suppliers whose rows should render as checked. */
export function shownSuppliers(rule: Rule, allIds: string[]): string[] {
  if (rule.mode === 'all') return allIds
  if (rule.mode === 'none') return []
  return rule.brand_ids
}

/**
 * Flip one supplier, given what is currently displayed.
 *
 * Clearing the last box means the same thing as "No offers", so it collapses
 * to 'none' rather than saving an empty 'selected' the API would reject.
 */
export function toggleSupplier(shown: string[], id: string): Rule {
  const next = shown.includes(id) ? shown.filter(x => x !== id) : [...shown, id]
  return { mode: next.length ? 'selected' : 'none', brand_ids: next }
}
