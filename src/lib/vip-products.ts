// ── VIP table products ───────────────────────────────────────────────────────
//
// The only VIP products are the tables we have saved from Fourvenues: every
// named table zone at a club, priced by the catalog agentbox publishes hourly
// (storage fourvenues/offers.json). See 20261009_vip_products.sql.
//
// Promoters don't own VIP products, they SELL them, in the order the operator
// ranks them per product (vip_product_sellers). On a given night:
//
//   1. The highest-ranked promoter who can sell that night gets the buy button.
//      Can sell = not hidden, VIP not shut down, and —
//        • with a Fourvenues channel (HypeList's set-up): their own channel
//          lists this table that night, not sold out;
//        • without one: they do VIP at this club (brand_vip_venues) on this
//          weekday, haven't suspended the night or paused the venue, and the
//          table is on sale that night (the catalog is where its price is).
//      A promoter who suspends a night or shuts down simply stops qualifying,
//      so the next one moves up — nobody has to resolve anything.
//   2. Nobody ranked can sell → whoever lists it on Fourvenues, as before.
//
// Checkout follows the seller: Fourvenues channel → their Fourvenues link;
// otherwise Fuoco checkout at the table's catalog price, deposit or full
// within the promoter's limit (partner_brands.vip_payment).
//
// The core is pure (resolveSeller, chargeFor) so it's tested without a
// database; loaders tolerate the migration not being applied.

import type { createServiceClient } from '@/lib/supabase/server'
import { parseValidDays, weekdayOf } from '@/lib/valid-days'
import { isFourvenuesOnlyBrandKey } from '@/lib/fourvenues-only'
import { mentionsWhatsApp } from '@/lib/whatsapp-rule'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// ── The catalog ──────────────────────────────────────────────────────────────

export interface FeedRate {
  id: string; name?: string | null; price: number
  pax?: number[] | null; deposit?: number | null; deposit_type?: string | null; full_payment?: boolean | null
}
export interface FeedProduct {
  id: string; name?: string | null; settle?: string; price?: number; sold_out?: boolean
  rates?: FeedRate[] | null
}
export interface FeedEvent {
  code: string; club_id?: string | null; night: string; brand?: string | null; channel?: string | null
  name?: string | null; venue?: string | null; products?: FeedProduct[]
}

/**
 * A Fourvenues zone's identity at a club. Fourvenues mints a new zone id every
 * night, so the name is the only stable key: lowercase, no accents, single
 * spaces. The iOS app normalises the same way (VipSellers.norm).
 */
export function normZone(name: unknown): string {
  return String(name ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

/** One table on sale one night, as one Fourvenues channel lists it. */
export interface Listing { event: FeedEvent; product: FeedProduct; brandKey: string }

/** club|night|zone → every channel's listing of that table that night. */
export type CatalogIndex = Map<string, Listing[]>
const ix = (club: string, night: string, zone: string) => `${club}|${night}|${zone}`

/** A table that hands the guest to WhatsApp isn't a product (lib/whatsapp-rule). */
export const isWhatsAppProduct = (p: FeedProduct) => mentionsWhatsApp(p.name, p.rates, (p as { detail?: unknown }).detail,
  (p as { checkout?: unknown }).checkout)

export function indexCatalog(events: FeedEvent[]): CatalogIndex {
  const out: CatalogIndex = new Map()
  for (const e of events) {
    if (!e.club_id || !e.night) continue
    for (const p of e.products ?? []) {
      if (p.settle !== 'table' || !p.name || isWhatsAppProduct(p)) continue
      const key = ix(e.club_id, e.night, normZone(p.name))
      const list = out.get(key) ?? []
      list.push({ event: e, product: p, brandKey: (e.brand ?? 'hypelist').toLowerCase() })
      out.set(key, list)
    }
  }
  return out
}

let cache: { at: number; events: FeedEvent[] } | null = null

/** The published catalog, cached for a minute. null = couldn't be read. */
export async function loadCatalog(): Promise<FeedEvent[] | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.events
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  try {
    const res = await fetch(`${base}/storage/v1/object/public/fourvenues/offers.json`, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return cache?.events ?? null
    const feed = await res.json() as { events?: FeedEvent[] }
    cache = { at: Date.now(), events: feed.events ?? [] }
    return cache.events
  } catch {
    return cache?.events ?? null
  }
}

// ── Sellers ──────────────────────────────────────────────────────────────────

export type VipPayment = 'both' | 'deposit' | 'full'
export type Checkout = 'fourvenues' | 'fuoco'

export interface SellerBrand {
  id: string; key: string; name: string; color: string
  hidden: boolean; vip_paused: boolean; vip_payment: VipPayment
  fourvenues_channel: string | null
}
export interface VipVenue {
  brand_id: string; club_id: string; valid_days: string; skipped_dates: string[]; paused: boolean
}

export const checkoutOf = (b: Pick<SellerBrand, 'fourvenues_channel'>): Checkout =>
  b.fourvenues_channel ? 'fourvenues' : 'fuoco'

/** Can this promoter sell this table tonight? */
export function canSell(
  brand: SellerBrand, venue: VipVenue | undefined, listings: Listing[], night: string,
): boolean {
  if (brand.hidden || brand.vip_paused) return false
  const onSale = listings.filter(l => !l.product.sold_out)
  if (brand.fourvenues_channel) return onSale.some(l => l.brandKey === brand.key)
  // Fuoco checkout. A Fourvenues-only promoter never sells through us.
  if (isFourvenuesOnlyBrandKey(brand.key)) return false
  if (!venue || venue.paused || onSale.length === 0) return false
  if (venue.skipped_dates.includes(night)) return false
  const days = parseValidDays(venue.valid_days)
  const wd = weekdayOf(night)
  return days.size === 0 || wd === null || days.has(wd)
}

export interface ResolvedSeller {
  brand_id: string | null
  brand_key: string
  brand_name: string
  checkout: Checkout
  /** false = nobody ranked could sell; the Fourvenues listing's own channel. */
  ranked: boolean
  payment: VipPayment
}

/**
 * Who gets the buy button for one table on one night.
 * `ranked` is the product's promoters, best first.
 */
export function resolveSeller(
  ranked: SellerBrand[],
  venueOf: (brandId: string) => VipVenue | undefined,
  listings: Listing[],
  night: string,
  brandsByKey: Map<string, SellerBrand>,
): ResolvedSeller | null {
  for (const b of ranked) {
    if (canSell(b, venueOf(b.id), listings, night)) {
      return {
        brand_id: b.id, brand_key: b.key, brand_name: b.name,
        checkout: checkoutOf(b), ranked: true, payment: b.vip_payment,
      }
    }
  }
  // Nobody ranked: the channel that lists it, on Fourvenues, as before —
  // skipping a channel whose promoter is hidden (the app hides it too).
  const live = listings.filter(l => !l.product.sold_out && !brandsByKey.get(l.brandKey)?.hidden)
  const pick = live[0] ?? listings.find(l => !brandsByKey.get(l.brandKey)?.hidden)
  if (!pick) return null
  const b = brandsByKey.get(pick.brandKey)
  return {
    brand_id: b?.id ?? null, brand_key: pick.brandKey, brand_name: b?.name ?? pick.brandKey,
    checkout: 'fourvenues', ranked: false, payment: 'both',
  }
}

// ── Price (Fuoco checkout) ───────────────────────────────────────────────────

export type PayMode = 'deposit' | 'full'

/** What the guest may pay now for this rate: the deposit, the full table, or both. */
export function payModes(rate: FeedRate, limit: VipPayment): PayMode[] {
  const dep = depositAmount(rate)
  const modes: PayMode[] = []
  if (dep != null && dep < rate.price) modes.push('deposit')
  modes.push('full')
  if (limit === 'deposit' && modes.includes('deposit')) return ['deposit']
  if (limit === 'full') return ['full']
  return modes
}

export function depositAmount(rate: FeedRate): number | null {
  const d = Number(rate.deposit ?? 0)
  if (!(d > 0)) return null
  return rate.deposit_type === 'porcentaje' ? rate.price * d / 100 : d
}

/** Cents due now, or null when this rate/mode/party isn't sellable. */
export function chargeFor(
  rate: FeedRate, mode: PayMode, pax: number, limit: VipPayment,
): number | null {
  if (!payModes(rate, limit).includes(mode)) return null
  const sizes = (rate.pax ?? []).filter(n => n > 0)
  if (sizes.length && !sizes.includes(pax)) return null
  if (pax < 1) return null
  const euros = mode === 'deposit' ? depositAmount(rate)! : rate.price
  return Math.round(euros * 100)
}

// ── Loaders ──────────────────────────────────────────────────────────────────

export interface VipState {
  brands: Map<string, SellerBrand>            // by id
  brandsByKey: Map<string, SellerBrand>
  venues: Map<string, VipVenue>               // brand|club
  products: Map<string, { id: string; club_id: string; zone_key: string; name: string }> // club|zone
  sellers: Map<string, string[]>              // product id → brand ids, best first
  migrated: boolean
}

export async function loadVipState(sb: SB): Promise<VipState> {
  const [b, v, p, s] = await Promise.all([
    sb.from('partner_brands').select('*'),
    sb.from('brand_vip_venues').select('*'),
    sb.from('vip_products').select('*'),
    sb.from('vip_product_sellers').select('*').order('rank', { ascending: true }),
  ])
  const brands = new Map<string, SellerBrand>()
  const brandsByKey = new Map<string, SellerBrand>()
  for (const r of (b.data ?? []) as Record<string, unknown>[]) {
    const brand: SellerBrand = {
      id: String(r.id), key: String(r.key ?? '').toLowerCase(), name: String(r.name ?? ''),
      color: String(r.color ?? '#888888'),
      hidden: r.offers_hidden === true,
      vip_paused: r.vip_paused === true,
      vip_payment: (['both', 'deposit', 'full'].includes(r.vip_payment as string) ? r.vip_payment : 'both') as VipPayment,
      fourvenues_channel: (r.fourvenues_channel as string | null) || null,
    }
    brands.set(brand.id, brand)
    brandsByKey.set(brand.key, brand)
  }
  const venues = new Map<string, VipVenue>()
  for (const r of (v.error ? [] : v.data ?? []) as Record<string, unknown>[]) {
    venues.set(`${r.brand_id}|${r.club_id}`, {
      brand_id: String(r.brand_id), club_id: String(r.club_id),
      valid_days: String(r.valid_days ?? 'Every night'),
      skipped_dates: ((r.skipped_dates as string[] | null) ?? []).map(String),
      paused: r.paused === true,
    })
  }
  const products = new Map<string, { id: string; club_id: string; zone_key: string; name: string }>()
  for (const r of (p.error ? [] : p.data ?? []) as Record<string, unknown>[]) {
    products.set(`${r.club_id}|${r.zone_key}`, {
      id: String(r.id), club_id: String(r.club_id), zone_key: String(r.zone_key), name: String(r.name ?? ''),
    })
  }
  const sellers = new Map<string, string[]>()
  for (const r of (s.error ? [] : s.data ?? []) as Record<string, unknown>[]) {
    const list = sellers.get(String(r.product_id)) ?? []
    list.push(String(r.brand_id))
    sellers.set(String(r.product_id), list)
  }
  return { brands, brandsByKey, venues, products, sellers, migrated: !p.error }
}

/** Resolve one table on one night against loaded state. */
export function sellerFor(
  state: VipState, catalog: CatalogIndex, clubId: string, night: string, zoneKey: string,
): ResolvedSeller | null {
  const listings = catalog.get(ix(clubId, night, zoneKey)) ?? []
  if (listings.length === 0) return null
  const product = state.products.get(`${clubId}|${zoneKey}`)
  const ranked = (product ? state.sellers.get(product.id) ?? [] : [])
    .map(id => state.brands.get(id)).filter((b): b is SellerBrand => !!b)
  return resolveSeller(ranked, id => state.venues.get(`${id}|${clubId}`), listings, night, state.brandsByKey)
}

export function listingsFor(catalog: CatalogIndex, clubId: string, night: string, zoneKey: string): Listing[] {
  return catalog.get(ix(clubId, night, zoneKey)) ?? []
}

/** What the app gets: club → night → zone → who sells it and how. */
export type PublicSellers = Record<string, Record<string, Record<string, {
  brand_key: string; brand_name: string; brand_color: string; checkout: Checkout; payment: VipPayment
}>>>

export function publicSellers(state: VipState, catalog: CatalogIndex): PublicSellers {
  const out: PublicSellers = {}
  for (const key of catalog.keys()) {
    const [club, night, zone] = key.split('|')
    const s = sellerFor(state, catalog, club, night, zone)
    if (!s) continue
    ;((out[club] ??= {})[night] ??= {})[zone] = {
      brand_key: s.brand_key, brand_name: s.brand_name,
      brand_color: state.brandsByKey.get(s.brand_key)?.color ?? '#C09950',
      checkout: s.checkout, payment: s.payment,
    }
  }
  return out
}

/** Make sure every table in the catalog exists as a product (portal load). */
export async function syncProducts(sb: SB, events: FeedEvent[]): Promise<void> {
  const seen = new Map<string, { club_id: string; zone_key: string; name: string }>()
  for (const e of events) {
    if (!e.club_id) continue
    for (const p of e.products ?? []) {
      if (p.settle !== 'table' || !p.name || isWhatsAppProduct(p)) continue
      const zone_key = normZone(p.name)
      if (zone_key) seen.set(`${e.club_id}|${zone_key}`, { club_id: e.club_id, zone_key, name: p.name })
    }
  }
  if (seen.size === 0) return
  const now = new Date().toISOString()
  await sb.from('vip_products').upsert(
    [...seen.values()].map(r => ({ ...r, last_seen_at: now })),
    { onConflict: 'club_id,zone_key' },
  )
}

// ── Pricing a Fuoco-checkout table booking ───────────────────────────────────

export type TableQuote =
  | {
      ok: true; cents: number; tablePrice: number
      seller: ResolvedSeller & { brand_id: string }
      productId: string | null; zoneName: string; rate: FeedRate
    }
  | { ok: false; reason: 'unavailable' | 'not_ours' | 'price_changed' | 'bad_choice' }

export const TABLE_QUOTE_MESSAGES: Record<Exclude<TableQuote, { ok: true }>['reason'], string> = {
  unavailable:   'This table isn’t on sale that night any more.',
  not_ours:      'This table is booked through Fourvenues tonight. Refresh and try again.',
  price_changed: 'This table’s price has changed. Check the new price and try again.',
  bad_choice:    'That group size or payment option isn’t available for this table.',
}

/**
 * Everything the server checks before charging for a table on Fuoco checkout:
 * the table is on sale that night, a Fuoco-checkout promoter holds its buy
 * button, the rate exists, the party fits, the payment mode is allowed — and
 * the amount the app shows matches. The app's amount is only ever a claim.
 */
export async function quoteTable(
  sb: SB,
  q: { clubId: string; night: string; zoneKey: string; rateId: string; pax: number; mode: PayMode; amountCents: number },
): Promise<TableQuote> {
  const events = await loadCatalog()
  if (!events) return { ok: false, reason: 'unavailable' }
  const catalog = indexCatalog(events)
  const zoneKey = normZone(q.zoneKey)
  const listings = listingsFor(catalog, q.clubId, q.night, zoneKey).filter(l => !l.product.sold_out)
  if (listings.length === 0) return { ok: false, reason: 'unavailable' }

  const state = await loadVipState(sb)
  const seller = sellerFor(state, catalog, q.clubId, q.night, zoneKey)
  if (!seller || seller.checkout !== 'fuoco' || !seller.brand_id) return { ok: false, reason: 'not_ours' }

  const rate = listings.flatMap(l => l.product.rates ?? []).find(r => r.id === q.rateId)
  if (!rate) return { ok: false, reason: 'price_changed' }
  const cents = chargeFor(rate, q.mode, q.pax, seller.payment)
  if (cents == null) return { ok: false, reason: 'bad_choice' }
  if (cents !== q.amountCents) return { ok: false, reason: 'price_changed' }

  return {
    ok: true, cents, tablePrice: rate.price,
    seller: { ...seller, brand_id: seller.brand_id },
    productId: state.products.get(`${q.clubId}|${zoneKey}`)?.id ?? null,
    zoneName: listings[0].product.name ?? zoneKey,
    rate,
  }
}

/**
 * A promoter's Fourvenues channel from whatever was pasted: the bare channel
 * ("clubfuoco-hype") or any Fourvenues link carrying it —
 *   site.fourvenues.com/en/iframe/<channel>/events
 *   web.fourvenues.com/es/iframe/<channel>/events/<event>
 *   www.fourvenues.com/assets/iframe/<channel>/events
 *   site.fourvenues.com/en/<channel>
 * One standard field for every promoter, the way HypeList's was set up.
 * null when nothing usable is in it.
 */
export function parseFourvenuesChannel(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let slug = s
  if (/fourvenues\.com/i.test(s) || s.includes('/')) {
    const path = s.replace(/^[a-z]+:\/\//i, '').replace(/^[^/]*fourvenues\.com/i, '').split(/[?#]/)[0]
    const parts = path.split('/').filter(Boolean)
    const at = parts.indexOf('iframe')
    if (at >= 0) slug = parts[at + 1] ?? ''
    else slug = parts.filter(p => !/^[a-z]{2}$/i.test(p) && p !== 'assets')[0] ?? ''
  }
  slug = slug.toLowerCase()
  return /^[a-z0-9][a-z0-9-]{1,59}$/.test(slug) ? slug : null
}

// ── A promoter's VIP settings (portal + promoter app share these) ────────────

export interface BrandVip {
  migrated: boolean
  vip_paused: boolean
  vip_payment: VipPayment
  checkout: Checkout
  fourvenues_channel: string | null
  venues: (VipVenue & { id: string; club_name: string })[]
}

export async function getBrandVip(sb: SB, brandId: string): Promise<BrandVip | null> {
  const { data: b } = await sb.from('partner_brands').select('*').eq('id', brandId).maybeSingle()
  if (!b) return null
  const r = b as Record<string, unknown>
  const { data: v, error } = await sb.from('brand_vip_venues').select('*').eq('brand_id', brandId)
  const rows = (error ? [] : v ?? []) as Record<string, unknown>[]
  const names = new Map<string, string>()
  if (rows.length) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', rows.map(x => String(x.club_id)))
    for (const c of (clubs ?? []) as { id: string; name: string }[]) names.set(c.id, c.name)
  }
  const channel = (r.fourvenues_channel as string | null) || null
  return {
    migrated: !error,
    vip_paused: r.vip_paused === true,
    vip_payment: (['both', 'deposit', 'full'].includes(r.vip_payment as string) ? r.vip_payment : 'both') as VipPayment,
    checkout: channel ? 'fourvenues' : 'fuoco',
    fourvenues_channel: channel,
    venues: rows.map(x => ({
      id: String(x.id), brand_id: brandId, club_id: String(x.club_id),
      club_name: names.get(String(x.club_id)) ?? 'Unknown venue',
      valid_days: String(x.valid_days ?? 'Every night'),
      skipped_dates: ((x.skipped_dates as string[] | null) ?? []).map(String).sort(),
      paused: x.paused === true,
    })).sort((a, b) => a.club_name.localeCompare(b.club_name)),
  }
}

export interface BrandVipPatch {
  vip_paused?: boolean
  vip_payment?: VipPayment
  /** Operator only: the full set of venues (adds, edits, removes). */
  venues?: { club_id: string; valid_days: string; skipped_dates?: string[]; paused?: boolean }[]
  /** Promoter app: edit the venues they already have — never add or remove. */
  venue_updates?: { club_id: string; skipped_dates?: string[]; paused?: boolean; valid_days?: string }[]
}

export const MIGRATION_HINT_VIP =
  'VIP selling needs a schema change that has not been applied yet — run ' +
  'supabase/migrations/20261009_vip_products.sql in the SQL editor.'

export async function saveBrandVip(sb: SB, brandId: string, patch: BrandVipPatch): Promise<string | null> {
  const brandPatch: Record<string, unknown> = {}
  if (patch.vip_paused !== undefined) brandPatch.vip_paused = patch.vip_paused
  if (patch.vip_payment !== undefined) brandPatch.vip_payment = patch.vip_payment
  if (Object.keys(brandPatch).length) {
    const { error } = await sb.from('partner_brands').update(brandPatch).eq('id', brandId)
    if (error) return /vip_/.test(error.message) ? MIGRATION_HINT_VIP : error.message
  }
  const clean = (d?: string[]) => [...new Set((d ?? []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort()
  if (patch.venues) {
    const keep = patch.venues.map(v => v.club_id)
    const del = keep.length
      ? await sb.from('brand_vip_venues').delete().eq('brand_id', brandId).not('club_id', 'in', `(${keep.join(',')})`)
      : await sb.from('brand_vip_venues').delete().eq('brand_id', brandId)
    if (del.error) return /brand_vip_venues/.test(del.error.message) ? MIGRATION_HINT_VIP : del.error.message
    if (patch.venues.length) {
      const { error } = await sb.from('brand_vip_venues').upsert(patch.venues.map(v => ({
        brand_id: brandId, club_id: v.club_id,
        valid_days: v.valid_days.trim() || 'Every night',
        skipped_dates: clean(v.skipped_dates), paused: v.paused === true,
      })), { onConflict: 'brand_id,club_id' })
      if (error) return error.message
    }
  }
  for (const u of patch.venue_updates ?? []) {
    const row: Record<string, unknown> = {}
    if (u.skipped_dates) row.skipped_dates = clean(u.skipped_dates)
    if (u.paused !== undefined) row.paused = u.paused
    if (u.valid_days !== undefined) row.valid_days = u.valid_days.trim() || 'Every night'
    if (!Object.keys(row).length) continue
    const { error } = await sb.from('brand_vip_venues').update(row).eq('brand_id', brandId).eq('club_id', u.club_id)
    if (error) return /brand_vip_venues/.test(error.message) ? MIGRATION_HINT_VIP : error.message
  }
  return null
}

/** Replace a product's ranked sellers (best first). */
export async function setSellers(
  sb: SB, productId: string, brandIds: string[],
): Promise<string | null> {
  const ids = [...new Set(brandIds)]
  const del = await sb.from('vip_product_sellers').delete().eq('product_id', productId)
  if (del.error) return /vip_product_sellers/.test(del.error.message) ? MIGRATION_HINT_VIP : del.error.message
  if (!ids.length) return null
  const { error } = await sb.from('vip_product_sellers')
    .insert(ids.map((brand_id, rank) => ({ product_id: productId, brand_id, rank })))
  return error?.message ?? null
}
