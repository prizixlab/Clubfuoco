import type { createServiceClient } from '@/lib/supabase/server'
import { loadCatalog, normZone, isWhatsAppProduct } from '@/lib/vip-products'
import type { DisclosureClub, DisclosureTable, TablePrice } from '@/lib/disclosure'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// The clubs a promoter works and the VIP tables they sell at each, for the
// disclosure. Clubs = where they've logged nights ∪ where they're ranked on a
// table. Tables = the vip_products they're ranked on (being ranked is what
// selling means) plus every table their own Fourvenues channel lists (HypeList
// sells its tables there and is ranked on almost none). Prices = every rate
// the catalog lists for that table — their own channel's listing when they
// have one, else every listing (Fuoco checkout sells at the catalog price).
export async function loadDisclosureClubs(sb: SB, brandId: string): Promise<DisclosureClub[] | null> {
  const { data: b } = await sb.from('partner_brands')
    .select('id, key, owner_user_id').eq('id', brandId).maybeSingle()
  if (!b) return null
  const brand = b as { id: string; key: string; owner_user_id: string | null }

  const [{ data: ranks }, nightClubs, events] = await Promise.all([
    sb.from('vip_product_sellers')
      .select('product:vip_products(id, club_id, zone_key, name)').eq('brand_id', brandId),
    brand.owner_user_id ? nightClubIds(sb, brand.owner_user_id) : Promise.resolve([] as string[]),
    loadCatalog(),
  ])

  type P = { id: string; club_id: string; zone_key: string; name: string }
  const products: P[] = []
  for (const row of (ranks ?? []) as { product: P | P[] | null }[]) {
    const p = Array.isArray(row.product) ? row.product[0] : row.product
    if (p) products.push(p)
  }

  // Tables their own channel lists, by club|zone — ranked ones win the name.
  const ownKey = (brand.key ?? '').toLowerCase()
  const byKey = new Map<string, P>()
  for (const e of events ?? []) {
    if (!e.club_id || (e.brand ?? 'hypelist').toLowerCase() !== ownKey) continue
    for (const fp of e.products ?? []) {
      if (fp.settle !== 'table' || !fp.name || isWhatsAppProduct(fp)) continue
      const zone = normZone(fp.name)
      byKey.set(`${e.club_id}|${zone}`, { id: '', club_id: e.club_id, zone_key: zone, name: fp.name.trim() })
    }
  }
  for (const p of products) byKey.set(`${p.club_id}|${p.zone_key}`, p)
  const tables = [...byKey.values()]

  const clubIds = [...new Set([...nightClubs, ...tables.map(p => p.club_id)])]
  if (!clubIds.length) return []
  const { data: clubs } = await sb.from('clubs').select('id, name').in('id', clubIds)
  const clubName = new Map(((clubs ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))

  const pricesOf = (p: P): TablePrice[] => {
    const all: { own: boolean; price: TablePrice }[] = []
    for (const e of events ?? []) {
      if (e.club_id !== p.club_id) continue
      const own = (e.brand ?? 'hypelist').toLowerCase() === ownKey
      for (const fp of e.products ?? []) {
        if (fp.settle !== 'table' || normZone(fp.name) !== p.zone_key || isWhatsAppProduct(fp)) continue
        const rates = fp.rates?.length ? fp.rates : (fp.price != null ? [{ id: '', price: fp.price }] : [])
        for (const r of rates) {
          if (!(Number(r.price) > 0)) continue
          const pax = (r.pax ?? []).filter(n => n > 0)
          const dep = Number(r.deposit ?? 0) > 0
            ? (r.deposit_type === 'porcentaje' ? r.price * Number(r.deposit) / 100 : Number(r.deposit))
            : null
          all.push({ own, price: {
            // A rate named after its own table says nothing new.
            label: r.name?.trim() && normZone(r.name) !== p.zone_key ? r.name.trim() : null,
            price: Number(r.price),
            pax: pax.length ? [Math.min(...pax), Math.max(...pax)] : null,
            deposit: dep,
          } })
        }
      }
    }
    const pool = all.some(x => x.own) ? all.filter(x => x.own) : all
    const seen = new Map<string, TablePrice>()
    for (const { price } of pool) seen.set(JSON.stringify(price), price)
    return [...seen.values()].sort((a, b) => a.price - b.price)
  }

  return clubIds
    .map(id => ({
      club_id: id,
      club_name: clubName.get(id) ?? 'Unknown venue',
      tables: tables.filter(p => p.club_id === id)
        .map((p): DisclosureTable => ({ key: `${p.club_id}|${p.zone_key}`, name: p.name, prices: pricesOf(p) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.club_name.localeCompare(b.club_name))
}

async function nightClubIds(sb: SB, ownerId: string): Promise<string[]> {
  const out = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('promoter_nights')
      .select('id, club_id').eq('created_by', ownerId).not('club_id', 'is', null)
      .order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error || !data?.length) break
    for (const r of data as { club_id: string }[]) out.add(r.club_id)
    if (data.length < PAGE) break
  }
  return [...out]
}
