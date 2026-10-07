import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok } from '@/lib/utils'
import {
  checkoutOf, indexCatalog, listingsFor, loadCatalog, loadVipState, normZone, sellerFor, syncProducts,
} from '@/lib/vip-products'

// GET /api/portal/vip — the VIP products board. Every table saved from
// Fourvenues, per club, with its ranked sellers and who holds its buy button
// on each upcoming night (lib/vip-products). Loading it also makes sure every
// table in the catalog exists as a product, so a new zone is rankable at once.

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const events = await loadCatalog()
  if (events) await syncProducts(sb, events).catch(() => {})
  const state = await loadVipState(sb)
  const catalog = indexCatalog(events ?? [])

  // Per club: the zones on sale and the nights each one is listed.
  const zones = new Map<string, Map<string, { name: string; nights: Set<string>; prices: number[] }>>()
  for (const e of events ?? []) {
    if (!e.club_id) continue
    for (const p of e.products ?? []) {
      if (p.settle !== 'table' || !p.name) continue
      const key = normZone(p.name)
      const club = zones.get(e.club_id) ?? new Map()
      const z = club.get(key) ?? { name: p.name, nights: new Set<string>(), prices: [] }
      z.nights.add(e.night)
      for (const r of p.rates ?? []) if (r.price > 0) z.prices.push(r.price)
      if (!(p.rates ?? []).length && (p.price ?? 0) > 0) z.prices.push(p.price!)
      club.set(key, z)
      zones.set(e.club_id, club)
    }
  }

  const clubIds = [...zones.keys()]
  const names = new Map<string, string>()
  for (let i = 0; i < clubIds.length; i += 200) {
    const { data } = await sb.from('clubs').select('id, name').in('id', clubIds.slice(i, i + 200))
    for (const c of (data ?? []) as { id: string; name: string }[]) names.set(c.id, c.name)
  }

  // Who can be ranked at all: VIP promoters (set up at a venue, or selling
  // through a Fourvenues channel) that aren't hidden.
  const vipBrandIds = new Set([...state.venues.values()].map(v => v.brand_id))
  const candidates = [...state.brands.values()]
    .filter(b => !b.hidden && (b.fourvenues_channel || vipBrandIds.has(b.id)))
    .sort((a, b) => a.name.localeCompare(b.name))

  const clubs = clubIds.map(clubId => {
    const clubZones = [...zones.get(clubId)!.entries()]
    const nights = [...new Set(clubZones.flatMap(([, z]) => [...z.nights]))].sort().slice(0, 10)
    return {
      club_id: clubId,
      club_name: names.get(clubId) ?? 'Unknown venue',
      nights,
      candidates: candidates.map(b => {
        const venue = state.venues.get(`${b.id}|${clubId}`)
        const onChannelHere = !!b.fourvenues_channel && clubZones.some(([key]) =>
          nights.some(n => listingsFor(catalog, clubId, n, key).some(l => l.brandKey === b.key)))
        return {
          id: b.id, name: b.name, color: b.color, checkout: checkoutOf(b),
          vip_paused: b.vip_paused,
          // Can they ever sell here? A Fuoco seller needs the venue set up;
          // a Fourvenues seller needs their channel to list this club.
          set_up: b.fourvenues_channel ? onChannelHere : !!venue,
          venue_days: venue?.valid_days ?? null,
          venue_paused: venue?.paused ?? false,
        }
      }),
      products: clubZones
        .map(([key, z]) => {
          const product = state.products.get(`${clubId}|${key}`)
          return {
            id: product?.id ?? null,
            zone_key: key,
            name: z.name,
            price_from: z.prices.length ? Math.min(...z.prices) : null,
            price_to: z.prices.length ? Math.max(...z.prices) : null,
            nights_on_sale: z.nights.size,
            sellers: product ? state.sellers.get(product.id) ?? [] : [],
            by_night: nights.map(n => {
              const s = z.nights.has(n) ? sellerFor(state, catalog, clubId, n, key) : null
              return {
                night: n,
                seller: s && { name: s.brand_name, checkout: s.checkout, ranked: s.ranked },
              }
            }),
          }
        })
        .sort((a, b) => (a.price_from ?? 0) - (b.price_from ?? 0) || a.name.localeCompare(b.name)),
    }
  }).sort((a, b) => a.club_name.localeCompare(b.club_name))

  return ok({ migrated: state.migrated, catalog: events !== null, clubs })
}
