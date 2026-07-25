import { describe, it, expect } from 'vitest'
import { getPartnerOffersByClub } from '@/lib/partner'

// Drives the real feed builder to assert what nights each supplier's offer
// shows, given day-aware conflict rules. 0=Sun … 6=Sat.

const CLUB = 'club-1', RUMBA = 'rumba-id', AASHI = 'aashi-id'

const brand = (id: string, key: string) => ({
  id, key, name: key, logo_url: null, color: '#fff',
  attribution_required: false, attribution_label: null,
})
const offer = (brand_id: string, kind: string, valid_days: string) => ({
  id: `${brand_id}-${kind}`, brand_id, club_id: CLUB, kind,
  title: kind, subtitle: '', price_eur: null, party_size: null,
  time_window: '', valid_days, dress_code: '', music: '', is_active: true, skipped_dates: [],
})

function fakeSb(rules: Record<string, unknown>[], offers = [
  offer(RUMBA, 'free_guestlist', 'Mon, Tue, Wed, Thu, Fri'),
  offer(AASHI, 'free_guestlist', 'Mon, Tue, Wed, Thu, Fri'),
]) {
  const tables: Record<string, unknown[]> = {
    partner_brands: [brand(RUMBA, 'rumba'), brand(AASHI, 'aashi')],
    partner_offers: offers,
    club_offer_visibility: rules,
  }
  return {
    from(table: string) {
      const rows = tables[table] ?? []
      const chain = {
        select: () => chain, order: () => chain, eq: () => chain,
        then: (res: (v: { data: unknown[]; error: null }) => unknown) => res({ data: rows, error: null }),
      }
      return chain
    },
  } as never
}

// valid_days a brand's offer ends up with in the feed (or absent = dropped).
const nightsFor = async (rules: Record<string, unknown>[], key: string) => {
  const map = await getPartnerOffersByClub(fakeSb(rules))
  const o = (map[CLUB] ?? []).find(x => x.brand?.key === key)
  return o ? o.valid_days : null
}

describe('day-aware conflict rules', () => {
  it('no rule → both suppliers show every offered night', async () => {
    expect(await nightsFor([], 'rumba')).toBe('Mon, Tue, Wed, Thu, Fri')
    expect(await nightsFor([], 'aashi')).toBe('Mon, Tue, Wed, Thu, Fri')
  })

  it('an all-nights rule still governs every night (backward compatible)', async () => {
    const rules = [{ club_id: CLUB, kind: 'free_guestlist', weekday: '*', mode: 'selected', brand_ids: [RUMBA] }]
    expect(await nightsFor(rules, 'rumba')).toBe('Mon, Tue, Wed, Thu, Fri')
    expect(await nightsFor(rules, 'aashi')).toBeNull()   // blocked every night → dropped
  })

  it('splits by day: Rumba on Tue, Aashi on Wed', async () => {
    // Base rule pins Rumba; Tuesday and Wednesday get their own overrides.
    const rules = [
      { club_id: CLUB, kind: 'free_guestlist', weekday: '*', mode: 'selected', brand_ids: [RUMBA] },
      { club_id: CLUB, kind: 'free_guestlist', weekday: '3', mode: 'selected', brand_ids: [AASHI] }, // Wed
    ]
    // Rumba: all nights except Wed
    expect(await nightsFor(rules, 'rumba')).toBe('Mon, Tue, Thu, Fri')
    // Aashi: only Wed (of its offered nights)
    expect(await nightsFor(rules, 'aashi')).toBe('Wed')
  })

  it('a day rule overrides the kind-wide rule only on that day', async () => {
    const rules = [
      { club_id: CLUB, kind: 'free_guestlist', weekday: '*', mode: 'none', brand_ids: [] },       // nobody, normally
      { club_id: CLUB, kind: 'free_guestlist', weekday: '5', mode: 'selected', brand_ids: [AASHI] }, // Fri: Aashi
    ]
    expect(await nightsFor(rules, 'rumba')).toBeNull()   // never
    expect(await nightsFor(rules, 'aashi')).toBe('Fri')  // only Friday
  })

  it('narrowing intersects with the offer’s own valid_days → drop on no overlap', async () => {
    // Aashi runs Mon–Wed but is only ALLOWED on Sat (blocked all other nights),
    // so there is no night it can actually show → dropped.
    const offers = [offer(AASHI, 'free_guestlist', 'Mon, Tue, Wed')]
    const rules = [
      { club_id: CLUB, kind: 'free_guestlist', weekday: '*', mode: 'selected', brand_ids: [RUMBA] }, // Aashi blocked
      { club_id: CLUB, kind: 'free_guestlist', weekday: '6', mode: 'selected', brand_ids: [AASHI] }, // except Sat
    ]
    const map = await getPartnerOffersByClub(fakeSb(rules, offers))
    expect((map[CLUB] ?? []).filter(o => o.brand?.key === 'aashi').length).toBe(0)
  })

  it('a pre-migration row (no weekday) reads as all-nights', async () => {
    const rules = [{ club_id: CLUB, kind: 'free_guestlist', mode: 'selected', brand_ids: [RUMBA] }]
    expect(await nightsFor(rules, 'aashi')).toBeNull()
    expect(await nightsFor(rules, 'rumba')).toBe('Mon, Tue, Wed, Thu, Fri')
  })
})
