import { describe, it, expect } from 'vitest'
import { getPartnerOffersByClub } from '@/lib/partner'

// Drives the real consumer gate, so these assert what guests actually see.

const CLUB = 'club-1'
const RUMBA = 'rumba-id', AASHI = 'aashi-id'

const brand = (id: string, key: string, extra = {}) => ({
  id, key, name: key, logo_url: null, color: '#fff',
  attribution_required: false, attribution_label: null, ...extra,
})
const offer = (brand_id: string, kind: string) => ({
  id: `${brand_id}-${kind}`, brand_id, club_id: CLUB, kind,
  title: kind, subtitle: '', price_eur: null, party_size: null,
  time_window: '', valid_days: 'Every night', dress_code: '', music: '',
  is_active: true, skipped_dates: [],
})

/** Minimal chainable stand-in for the tables getPartnerOffersByClub reads. */
function fakeSb(rules: Record<string, unknown>[]) {
  const tables: Record<string, unknown[]> = {
    partner_brands: [brand(RUMBA, 'rumba'), brand(AASHI, 'aashi')],
    partner_offers: [
      offer(RUMBA, 'vip_table'), offer(RUMBA, 'free_guestlist'),
      offer(AASHI, 'free_guestlist'),
    ],
    club_offer_visibility: rules,
  }
  return {
    from(table: string) {
      const rows = tables[table] ?? []
      const chain = {
        select: () => chain,
        order:  () => chain,
        eq:     () => chain,
        then:   (res: (v: { data: unknown[]; error: null }) => unknown) =>
                  res({ data: rows, error: null }),
      }
      return chain
    },
  } as never
}

const shown = async (rules: Record<string, unknown>[]) => {
  const map = await getPartnerOffersByClub(fakeSb(rules))
  return (map[CLUB] ?? []).map(o => `${o.brand?.key}:${o.kind}`).sort()
}

describe('per-kind conflict rules', () => {
  it('shows everything when there is no rule', async () => {
    expect(await shown([])).toEqual(
      ['aashi:free_guestlist', 'rumba:free_guestlist', 'rumba:vip_table'])
  })

  it('a venue-wide rule still governs every kind (pre-migration rows)', async () => {
    // No `kind` column on the row — exactly what an existing rule looks like.
    expect(await shown([{ club_id: CLUB, mode: 'selected', brand_ids: [RUMBA] }]))
      .toEqual(['rumba:free_guestlist', 'rumba:vip_table'])
  })

  it('splits the products: Rumba on tables, Aashi on the door', async () => {
    expect(await shown([
      { club_id: CLUB, kind: 'vip_table',      mode: 'selected', brand_ids: [RUMBA] },
      { club_id: CLUB, kind: 'free_guestlist', mode: 'selected', brand_ids: [AASHI] },
    ])).toEqual(['aashi:free_guestlist', 'rumba:vip_table'])
  })

  it('a kind rule wins over the venue-wide one, which still covers the rest', async () => {
    expect(await shown([
      { club_id: CLUB, kind: '*',              mode: 'selected', brand_ids: [RUMBA] },
      { club_id: CLUB, kind: 'free_guestlist', mode: 'selected', brand_ids: [AASHI] },
    ])).toEqual(['aashi:free_guestlist', 'rumba:vip_table'])
  })

  it("'none' on one kind leaves the other kind alone", async () => {
    expect(await shown([{ club_id: CLUB, kind: 'free_guestlist', mode: 'none', brand_ids: [] }]))
      .toEqual(['rumba:vip_table'])
  })

  it('a hidden supplier stays hidden even when a kind rule selects it', async () => {
    const map = await getPartnerOffersByClub((() => {
      const sb = fakeSb([{ club_id: CLUB, kind: 'free_guestlist', mode: 'selected', brand_ids: [AASHI] }])
      // re-point partner_brands so Aashi is muted brand-wide
      const orig = (sb as unknown as { from: (t: string) => unknown }).from
      return {
        from(table: string) {
          if (table !== 'partner_brands') return (orig as (t: string) => unknown)(table)
          const rows = [brand(RUMBA, 'rumba'), brand(AASHI, 'aashi', { offers_hidden: true })]
          const chain = {
            select: () => chain, order: () => chain, eq: () => chain,
            then: (res: (v: { data: unknown[]; error: null }) => unknown) => res({ data: rows, error: null }),
          }
          return chain
        },
      } as never
    })())
    const visible = (map[CLUB] ?? []).map(o => `${o.brand?.key}:${o.kind}`)
    // Aashi is selected for the guestlist but muted brand-wide, so it must not
    // appear — and the rule for the guestlist must not leak onto VIP tables,
    // which no rule governs and which therefore still run.
    expect(visible).not.toContain('aashi:free_guestlist')
    expect(visible).toEqual(['rumba:vip_table'])
  })
})
