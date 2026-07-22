import { describe, it, expect } from 'vitest'
import { getActiveBrand } from '@/lib/partner'

// Fake the two calls getActiveBrand makes.
function sbWith(rows: Record<string, unknown>[]) {
  return { from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }) } as never
}
const b = (key: string, extra = {}) => ({
  id: key, key, name: key, logo_url: null, color: '#fff',
  attribution_required: false, attribution_label: null, ...extra,
})

describe('getActiveBrand with the one-featured index dropped', () => {
  it('returns null when none featured', async () => {
    expect(await getActiveBrand(sbWith([]))).toBeNull()
  })
  it('returns the one when exactly one', async () => {
    expect((await getActiveBrand(sbWith([b('rumba')])))?.key).toBe('rumba')
  })
  it('does NOT error on several — picks deterministically by key', async () => {
    const first  = await getActiveBrand(sbWith([b('rumba'), b('aashi')]))
    const second = await getActiveBrand(sbWith([b('aashi'), b('rumba')]))
    expect(first?.key).toBe('aashi')
    expect(second?.key).toBe(first?.key)   // stable regardless of row order
  })
  it('skips a hidden supplier when another is available', async () => {
    const got = await getActiveBrand(sbWith([b('aashi', { offers_hidden: true }), b('rumba')]))
    expect(got?.key).toBe('rumba')
  })
  it('still returns something when every featured brand is hidden', async () => {
    const got = await getActiveBrand(sbWith([b('aashi', { offers_hidden: true })]))
    expect(got?.key).toBe('aashi')
  })
})
