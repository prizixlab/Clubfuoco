import { describe, expect, it } from 'vitest'
import { provisionBrandForUser } from './offer-auth'

// provisionBrandForUser is the single provisioning path shared by the promoter
// app (first offer) and the portal (on approval / backfill). Its two guarantees
// matter: it's idempotent (never a second brand per owner → never trips the
// unique index), and it always produces a named brand.

const UID = 'abcd1234-0000-0000-0000-000000000000'

interface Opts {
  existingBrand?: Record<string, unknown> | null
  profile?: { brand_name?: string | null; logo_url?: string | null } | null
  user?: { full_name?: string | null; email?: string | null } | null
}

function fakeSb({ existingBrand = null, profile = null, user = null }: Opts) {
  const inserted: Record<string, unknown>[] = []
  const sb = {
    from(table: string) {
      if (table === 'partner_brands') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingBrand, error: null }) }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserted.push(row)
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-brand-id', ...row }, error: null }) }) }
          },
        }
      }
      if (table === 'promoter_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profile, error: null }) }) }) }
      }
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: user, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { sb: sb as never, inserted }
}

const brandRow = (over: Record<string, unknown> = {}) => ({
  id: 'existing-id', key: 'existing', name: 'Existing', logo_url: null,
  color: '#C09950', attribution_required: false, attribution_label: null, ...over,
})

describe('provisionBrandForUser', () => {
  it('is idempotent — returns the existing brand and inserts nothing', async () => {
    const { sb, inserted } = fakeSb({ existingBrand: brandRow({ id: 'B1', name: 'Rumba' }) })
    const brand = await provisionBrandForUser(sb, UID)
    expect(brand.id).toBe('B1')
    expect(brand.name).toBe('Rumba')
    expect(inserted).toHaveLength(0) // never inserts a second brand
  })

  it('provisions from the promoter profile brand_name when present', async () => {
    const { sb, inserted } = fakeSb({ profile: { brand_name: 'Neon Nights', logo_url: 'x.png' } })
    const brand = await provisionBrandForUser(sb, UID)
    expect(brand.name).toBe('Neon Nights')
    expect(inserted[0]).toMatchObject({
      name: 'Neon Nights', logo_url: 'x.png', is_active: false, owner_user_id: UID,
      key: `neon-nights-${UID.slice(0, 8)}`,
    })
  })

  it('falls back to the account full name, then email local-part', async () => {
    const byName = fakeSb({ user: { full_name: 'Jane Doe', email: 'j@x.com' } })
    expect((await provisionBrandForUser(byName.sb, UID)).name).toBe('Jane Doe')

    const byEmail = fakeSb({ user: { full_name: null, email: 'party@x.com' } })
    expect((await provisionBrandForUser(byEmail.sb, UID)).name).toBe('party')
  })

  it('never produces a nameless brand', async () => {
    const { sb } = fakeSb({})
    expect((await provisionBrandForUser(sb, UID)).name).toBe('Promoter')
  })
})
