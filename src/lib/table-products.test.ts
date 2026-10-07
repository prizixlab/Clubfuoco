import { describe, expect, it } from 'vitest'
import {
  effectiveSeller, fourvenuesSellsTable, normZone, offerSellsTable, publicTablesByClub,
  toClubTable, type ClubTable, type TableMap,
} from './table-products'
import { offerRunsOn } from './partner'

const table = (over: Partial<ClubTable> = {}): ClubTable => ({
  id: 't1', club_id: 'c1', name: 'Gold Booth', fourvenues_zones: ['gold vip'],
  seller: 'auto', seller_offer_id: null, sort_order: 0, ...over,
})
const map = (...ts: ClubTable[]): TableMap => new Map(ts.map(t => [t.id, t]))

describe('normZone — a Fourvenues zone is its name at the club', () => {
  it('ignores case, accents and spacing', () => {
    expect(normZone('  TERRACE  -  Clicquot ')).toBe('terrace - clicquot')
    expect(normZone('Zona Pública')).toBe('zona publica')
  })
  it('normalises stored zones too', () => {
    expect(toClubTable({ id: 'x', club_id: 'c', name: 'n', fourvenues_zones: ['GOLD  VIP', ''] }).fourvenues_zones)
      .toEqual(['gold vip'])
  })
  it('reads an unknown seller as auto', () => {
    expect(toClubTable({ id: 'x', club_id: 'c', name: 'n', seller: 'bogus' }).seller).toBe('auto')
  })
})

describe('offerSellsTable — each table its own product', () => {
  const live = new Set(['o1', 'o2'])

  it('a listing in no table always shows — nobody gets dibs on the venue', () => {
    expect(offerSellsTable({ id: 'o1', table_id: null }, map(), live)).toBe(true)
    expect(offerSellsTable({ id: 'o1' }, map(), live)).toBe(true)           // pre-migration row
  })

  it('a dangling table link reads as a product on its own', () => {
    expect(offerSellsTable({ id: 'o1', table_id: 'gone' }, map(), live)).toBe(true)
  })

  it('auto: every listing of the table shows', () => {
    const t = map(table())
    expect(offerSellsTable({ id: 'o1', table_id: 't1' }, t, live)).toBe(true)
    expect(offerSellsTable({ id: 'o2', table_id: 't1' }, t, live)).toBe(true)
  })

  it('offer: only the chosen listing gets the buy button', () => {
    const t = map(table({ seller: 'offer', seller_offer_id: 'o2' }))
    expect(offerSellsTable({ id: 'o1', table_id: 't1' }, t, live)).toBe(false)
    expect(offerSellsTable({ id: 'o2', table_id: 't1' }, t, live)).toBe(true)
  })

  it('offer: a chosen listing that is no longer live falls back to auto', () => {
    const t = map(table({ seller: 'offer', seller_offer_id: 'o2' }))
    expect(offerSellsTable({ id: 'o1', table_id: 't1' }, t, new Set(['o1']))).toBe(true)
    expect(effectiveSeller(t.get('t1')!, new Set(['o1'])).seller).toBe('auto')
  })

  it('fourvenues / none: none of our listings of that table show', () => {
    expect(offerSellsTable({ id: 'o1', table_id: 't1' }, map(table({ seller: 'fourvenues' })), live)).toBe(false)
    expect(offerSellsTable({ id: 'o1', table_id: 't1' }, map(table({ seller: 'none' })), live)).toBe(false)
  })

  it('one table decided never touches another table at the same venue', () => {
    const t = map(table({ seller: 'fourvenues' }), table({ id: 't2', name: 'Silver', fourvenues_zones: [] }))
    expect(offerSellsTable({ id: 'o1', table_id: 't1' }, t, live)).toBe(false)
    expect(offerSellsTable({ id: 'o2', table_id: 't2' }, t, live)).toBe(true)
  })
})

describe('fourvenuesSellsTable / publicTablesByClub — what the app hides', () => {
  const live = new Set(['o1'])
  it('Fourvenues keeps a table unless it went to one of ours or to nobody', () => {
    expect(fourvenuesSellsTable(table(), live)).toBe(true)
    expect(fourvenuesSellsTable(table({ seller: 'fourvenues' }), live)).toBe(true)
    expect(fourvenuesSellsTable(table({ seller: 'offer', seller_offer_id: 'o1' }), live)).toBe(false)
    expect(fourvenuesSellsTable(table({ seller: 'none' }), live)).toBe(false)
  })

  it('publishes the EFFECTIVE decision per club', () => {
    const out = publicTablesByClub(map(
      table({ seller: 'offer', seller_offer_id: 'o1' }),
      table({ id: 't2', club_id: 'c2', seller: 'offer', seller_offer_id: 'dead' }),
    ), live)
    expect(out.c1[0]).toMatchObject({ seller: 'offer', offer_id: 'o1', fourvenues_on_sale: false, fourvenues_zones: ['gold vip'] })
    expect(out.c2[0]).toMatchObject({ seller: 'auto', offer_id: null, fourvenues_on_sale: true })
  })
})

// ── The booking gate, end to end through offerRunsOn ───────────────────────

const SATURDAY = '2026-07-25'

function fakeSb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(name: string) {
      const rows = tables[name] ?? []
      if (name === 'partner_brands') return { select: () => Promise.resolve({ data: rows, error: null }) }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      }
      return chain
    },
  } as never
}

describe('offerRunsOn — VIP is judged per table, not per venue', () => {
  const brands = [{ id: 'b1', key: 'rumba', name: 'Rumba' }, { id: 'b2', key: 'aashi', name: 'Aashi' }]
  const offer = (id: string, brand: string, over: Record<string, unknown> = {}) =>
    ({ id, brand_id: brand, club_id: 'c1', kind: 'vip_table', valid_days: 'Every night', skipped_dates: [], ...over })

  it('a venue-wide rule naming one promoter no longer hides another promoter’s table', async () => {
    const sb = fakeSb({
      partner_brands: brands,
      partner_offers: [offer('o1', 'b1'), offer('o2', 'b2')],
      club_offer_visibility: [{ club_id: 'c1', kind: 'vip_table', weekday: '*', mode: 'selected', brand_ids: ['b1'] }],
      club_tables: [],
    })
    expect(await offerRunsOn(sb, 'c1', 'vip_table', SATURDAY)).toBe(true)
  })

  it('refuses when the only table went to Fourvenues', async () => {
    const sb = fakeSb({
      partner_brands: brands,
      partner_offers: [offer('o1', 'b1', { table_id: 't1' })],
      club_tables: [{ id: 't1', club_id: 'c1', name: 'Gold', seller: 'fourvenues', fourvenues_zones: ['gold'] }],
    })
    expect(await offerRunsOn(sb, 'c1', 'vip_table', SATURDAY)).toBe(false)
  })

  it('one table skipping tonight doesn’t close the others', async () => {
    const sb = fakeSb({
      partner_brands: brands,
      partner_offers: [offer('o1', 'b1', { skipped_dates: [SATURDAY] }), offer('o2', 'b2')],
      club_tables: [],
    })
    expect(await offerRunsOn(sb, 'c1', 'vip_table', SATURDAY)).toBe(true)
  })

  it('an archived table can’t be booked', async () => {
    const sb = fakeSb({ partner_brands: brands, partner_offers: [offer('o1', 'b1', { is_active: false })], club_tables: [] })
    expect(await offerRunsOn(sb, 'c1', 'vip_table', SATURDAY)).toBe(false)
  })

  it('guestlists keep the per-venue rule', async () => {
    const sb = fakeSb({
      partner_brands: brands,
      partner_offers: [
        { id: 'g1', brand_id: 'b1', kind: 'free_guestlist', valid_days: 'Every night', skipped_dates: [] },
        { id: 'g2', brand_id: 'b2', kind: 'free_guestlist', valid_days: 'Every night', skipped_dates: [] },
      ],
      club_offer_visibility: [{ club_id: 'c1', kind: 'free_guestlist', weekday: '*', mode: 'none', brand_ids: [] }],
    })
    expect(await offerRunsOn(sb, 'c1', 'free_guestlist', SATURDAY)).toBe(false)
  })
})
