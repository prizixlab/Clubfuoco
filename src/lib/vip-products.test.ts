import { describe, expect, it } from 'vitest'
import {
  canSell, chargeFor, indexCatalog, normZone, parseFourvenuesChannel, payModes, resolveSeller,
  type FeedEvent, type Listing, type SellerBrand, type VipVenue,
} from './vip-products'

const SAT = '2026-10-10'   // a Saturday
const CLUB = 'c1'

const brand = (key: string, over: Partial<SellerBrand> = {}): SellerBrand => ({
  id: `id-${key}`, key, name: key, color: '#000', hidden: false, vip_paused: false,
  vip_payment: 'both', fourvenues_channel: null, ...over,
})
const hypelist = brand('hypelist', { fourvenues_channel: 'clubfuoco-hype' })
const rumba = brand('rumba')
const nova = brand('nova')

const venue = (b: SellerBrand, over: Partial<VipVenue> = {}): VipVenue => ({
  brand_id: b.id, club_id: CLUB, valid_days: 'Every night', skipped_dates: [], paused: false, ...over,
})

const event = (brandKey: string, products: FeedEvent['products'], night = SAT): FeedEvent =>
  ({ code: `E-${brandKey}`, club_id: CLUB, night, brand: brandKey, products })
const gold = { id: 'z1', name: 'GOLD  VIP', settle: 'table', price: 300,
  rates: [{ id: 'r1', name: 'Gold', price: 300, pax: [4, 5, 6], deposit: 50, deposit_type: 'porcentaje', full_payment: true }] }

const listings = (...evs: FeedEvent[]): Listing[] =>
  indexCatalog(evs).get(`${CLUB}|${SAT}|${normZone('Gold VIP')}`) ?? []

const byKey = new Map([hypelist, rumba, nova].map(b => [b.key, b]))
const venues = new Map([venue(rumba), venue(nova)].map(v => [v.brand_id, v]))
const resolve = (ranked: SellerBrand[], ls: Listing[], vs = venues) =>
  resolveSeller(ranked, id => vs.get(id), ls, SAT, byKey)

describe('a saved table is identified by its zone name at the club', () => {
  it('normalises case, accents and spacing', () => {
    expect(normZone('  GOLD  VIP ')).toBe('gold vip')
    expect(normZone('Zona Pública')).toBe('zona publica')
  })
  it('indexes the same table from different channels together', () => {
    expect(listings(event('hypelist', [gold]), event('besolist', [{ ...gold, name: 'Gold Vip' }]))).toHaveLength(2)
  })
})

describe('resolveSeller — ranked promoters, first one selling wins', () => {
  const ls = listings(event('hypelist', [gold]))

  it('the top-ranked promoter who is selling gets the buy button, on Fuoco checkout', () => {
    expect(resolve([rumba, nova], ls)).toMatchObject({ brand_key: 'rumba', checkout: 'fuoco', ranked: true })
  })

  it('a promoter who suspends tonight is skipped — the next moves up', () => {
    const vs = new Map(venues); vs.set(rumba.id, venue(rumba, { skipped_dates: [SAT] }))
    expect(resolve([rumba, nova], ls, vs)?.brand_key).toBe('nova')
  })

  it('a promoter who shuts VIP down is skipped', () => {
    expect(resolve([{ ...rumba, vip_paused: true }, nova], ls)?.brand_key).toBe('nova')
  })

  it('a paused club is skipped', () => {
    const paused = new Map(venues); paused.set(rumba.id, venue(rumba, { paused: true }))
    expect(resolve([rumba, nova], ls, paused)?.brand_key).toBe('nova')
  })

  it('being ranked is enough — no per-club set-up', () => {
    expect(resolve([brand('stranger'), nova], ls)).toMatchObject({ brand_key: 'stranger', checkout: 'fuoco' })
  })

  it('Fourvenues is just how they check out: their channel lists it → Fourvenues, else Fuoco', () => {
    expect(resolve([hypelist, rumba], ls)).toMatchObject({ brand_key: 'hypelist', checkout: 'fourvenues', ranked: true })
    const beso = brand('besolist', { fourvenues_channel: 'besolist' })
    expect(resolve([beso], ls)).toMatchObject({ brand_key: 'besolist', checkout: 'fuoco' })
  })

  it('HypeList stays Fourvenues-only: off its channel it is skipped, never Fuoco', () => {
    const otherChannel = listings(event('besolist', [gold]))
    expect(resolve([hypelist, rumba], otherChannel)?.brand_key).toBe('rumba')
  })

  it('nobody ranked selling → the Fourvenues listing, as before', () => {
    expect(resolve([], ls)).toMatchObject({ brand_key: 'hypelist', checkout: 'fourvenues', ranked: false })
    expect(resolve([{ ...rumba, vip_paused: true }], ls)).toMatchObject({ brand_key: 'hypelist', ranked: false })
  })

  it('a sold-out table can’t be sold on Fuoco checkout', () => {
    const soldOut = listings(event('hypelist', [{ ...gold, sold_out: true }]))
    expect(canSell(rumba, venue(rumba), soldOut, SAT)).toBeNull()
  })

  it('a hidden or Fourvenues-only promoter never sells on Fuoco checkout', () => {
    expect(canSell({ ...rumba, hidden: true }, venue(rumba), ls, SAT)).toBeNull()
    const fvOnly = brand('hypelist')   // channel removed, still Fourvenues-only
    expect(canSell(fvOnly, venue(fvOnly), ls, SAT)).toBeNull()
  })
})

describe('Fuoco checkout price — the catalog’s, never the app’s', () => {
  const rate = gold.rates[0]

  it('guest chooses deposit or full by default', () => {
    expect(payModes(rate, 'both')).toEqual(['deposit', 'full'])
    expect(chargeFor(rate, 'deposit', 4, 'both')).toBe(15000)
    expect(chargeFor(rate, 'full', 4, 'both')).toBe(30000)
  })

  it('the promoter’s limit narrows the choice', () => {
    expect(payModes(rate, 'deposit')).toEqual(['deposit'])
    expect(chargeFor(rate, 'full', 4, 'deposit')).toBeNull()
    expect(payModes(rate, 'full')).toEqual(['full'])
    expect(chargeFor(rate, 'deposit', 4, 'full')).toBeNull()
  })

  it('a 100% or missing deposit means full only', () => {
    expect(payModes({ ...rate, deposit: 100 }, 'both')).toEqual(['full'])
    expect(payModes({ ...rate, deposit: null }, 'deposit')).toEqual(['full'])
  })

  it('a fixed-amount deposit', () => {
    expect(chargeFor({ ...rate, deposit: 80, deposit_type: 'por_reserva' }, 'deposit', 5, 'both')).toBe(8000)
  })

  it('the party has to fit the table', () => {
    expect(chargeFor(rate, 'full', 2, 'both')).toBeNull()
    expect(chargeFor({ ...rate, pax: null }, 'full', 2, 'both')).toBe(30000)
  })
})

describe('parseFourvenuesChannel — one standard field for every promoter', () => {
  it('takes the bare channel or any Fourvenues link', () => {
    expect(parseFourvenuesChannel('clubfuoco-hype')).toBe('clubfuoco-hype')
    expect(parseFourvenuesChannel('https://site.fourvenues.com/en/iframe/clubfuoco-hype/events')).toBe('clubfuoco-hype')
    expect(parseFourvenuesChannel('web.fourvenues.com/es/iframe/BesoList/events/x-12')).toBe('besolist')
    expect(parseFourvenuesChannel('https://www.fourvenues.com/assets/iframe/ku-barcelona/events')).toBe('ku-barcelona')
    expect(parseFourvenuesChannel('https://site.fourvenues.com/en/besolist')).toBe('besolist')
  })
  it('rejects junk', () => {
    expect(parseFourvenuesChannel('')).toBeNull()
    expect(parseFourvenuesChannel('https://site.fourvenues.com/en/iframe/')).toBeNull()
    expect(parseFourvenuesChannel('not a channel!')).toBeNull()
  })
})

describe('no WhatsApp offers', () => {
  it('a "WhatsApp" zone is never a VIP product', () => {
    const boris = { id: 'w', name: 'WhatsApp', settle: 'table', price: 0, rates: [{ id: 'r', name: 'WhatsApp', price: 0 }] }
    expect(indexCatalog([event('hypelist', [boris, gold])]).size).toBe(1)
  })
})
