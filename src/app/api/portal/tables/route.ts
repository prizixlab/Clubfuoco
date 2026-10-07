import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { effectiveSeller, loadTables, normZone } from '@/lib/table-products'
import { ok, err } from '@/lib/utils'
import { isMissingSchema, MIGRATION_HINT, TableInput, writeTable } from './_shared'

// Every VIP table is its own product (lib/table-products). This is where the
// operator says which listings are the SAME table and who gets its buy button.
//
// GET — per venue: the tables, our VIP listings, and the Fourvenues zones on
// sale there (read from the catalog agentbox publishes hourly). Listings in no
// table are products on their own and simply show.

interface FeedProduct { name?: string; settle?: string; price?: number; sold_out?: boolean }
interface FeedEvent { club_id?: string; night?: string; brand?: string; products?: FeedProduct[] }

interface Zone {
  key:        string          // normZone(name) — what a table stores
  name:       string          // as Fourvenues spells it
  brand_key:  string
  price_from: number | null
  nights:     number
  next_night: string | null
}

async function fourvenuesZones(): Promise<Map<string, Map<string, Zone>> | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  try {
    const res = await fetch(`${base}/storage/v1/object/public/fourvenues/offers.json`, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const feed = await res.json() as { events?: FeedEvent[] }
    const byClub = new Map<string, Map<string, Zone>>()
    for (const e of feed.events ?? []) {
      if (!e.club_id) continue
      for (const p of e.products ?? []) {
        if (p.settle !== 'table' || !p.name) continue
        const key = normZone(p.name)
        if (!key) continue
        const zones = byClub.get(e.club_id) ?? new Map<string, Zone>()
        const z = zones.get(key) ?? {
          key, name: p.name, brand_key: e.brand ?? 'hypelist',
          price_from: null, nights: 0, next_night: null,
        }
        z.nights++
        if (typeof p.price === 'number' && p.price > 0) {
          z.price_from = z.price_from == null ? p.price : Math.min(z.price_from, p.price)
        }
        if (e.night && (!z.next_night || e.night < z.next_night)) z.next_night = e.night
        zones.set(key, z)
        byClub.set(e.club_id, zones)
      }
    }
    return byClub
  } catch {
    return null
  }
}

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const probe = await sb.from('club_tables').select('id').limit(1)
  const migrated = !probe.error

  const [{ data: offers }, { data: brands }, tables, zonesByClub] = await Promise.all([
    sb.from('partner_offers').select('*').eq('kind', 'vip_table'),
    sb.from('partner_brands').select('*'),
    loadTables(sb),
    fourvenuesZones(),
  ])

  const brandById = new Map<string, { name: string; color: string; hidden: boolean; key: string }>()
  for (const b of (brands ?? []) as Record<string, unknown>[]) {
    brandById.set(String(b.id), {
      name: String(b.name ?? ''), color: String(b.color ?? '#888888'),
      hidden: b.offers_hidden === true, key: String(b.key ?? ''),
    })
  }
  const brandNameByKey = new Map([...brandById.values()].map(b => [b.key, b.name]))

  const rows = (offers ?? []) as Record<string, unknown>[]
  const liveIds = new Set(rows
    .filter(r => r.is_active !== false && !brandById.get(String(r.brand_id))?.hidden)
    .map(r => String(r.id)))

  const clubIds = new Set<string>()
  rows.forEach(r => clubIds.add(String(r.club_id)))
  tables.forEach(t => clubIds.add(t.club_id))
  zonesByClub?.forEach((_, id) => clubIds.add(id))

  const names = new Map<string, string>()
  const ids = [...clubIds]
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('clubs').select('id, name').in('id', ids.slice(i, i + 200))
    for (const c of (data ?? []) as { id: string; name: string }[]) names.set(c.id, c.name)
  }

  const clubs = ids.map(clubId => {
    const clubTables = [...tables.values()].filter(t => t.club_id === clubId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const zoneMap = zonesByClub?.get(clubId) ?? new Map<string, Zone>()
    // A zone a table names that the catalog doesn't carry right now (no nights
    // on sale) still belongs to the table — show it, marked off sale.
    for (const t of clubTables) for (const z of t.fourvenues_zones) {
      if (!zoneMap.has(z)) zoneMap.set(z, { key: z, name: z, brand_key: '', price_from: null, nights: 0, next_night: null })
    }
    return {
      club_id:   clubId,
      club_name: names.get(clubId) ?? 'Unknown venue',
      tables: clubTables.map(t => {
        const eff = effectiveSeller(t, liveIds)
        return {
          id: t.id, name: t.name,
          seller: t.seller, seller_offer_id: t.seller_offer_id,
          effective_seller: eff.seller,
          fourvenues_zones: t.fourvenues_zones,
          offer_ids: rows.filter(r => r.table_id === t.id).map(r => String(r.id)),
        }
      }),
      offers: rows.filter(r => String(r.club_id) === clubId).map(r => {
        const b = brandById.get(String(r.brand_id))
        return {
          id: String(r.id),
          title: String(r.title ?? 'VIP Table'),
          subtitle: String(r.subtitle ?? ''),
          price_eur: r.price_eur == null ? null : Number(r.price_eur),
          valid_days: String(r.valid_days ?? ''),
          live: liveIds.has(String(r.id)),
          table_id: (r.table_id as string | null) ?? null,
          brand: { name: b?.name ?? 'Unknown', color: b?.color ?? '#888888', hidden: b?.hidden ?? false },
        }
      }),
      zones: [...zoneMap.values()]
        .map(z => ({
          ...z,
          brand_name: brandNameByKey.get(z.brand_key) ?? (z.brand_key || 'Fourvenues'),
          table_id: clubTables.find(t => t.fourvenues_zones.includes(z.key))?.id ?? null,
        }))
        .sort((a, b) => (a.price_from ?? 0) - (b.price_from ?? 0) || a.name.localeCompare(b.name)),
    }
  })
    // Only venues with something to decide on, busiest first.
    .filter(c => c.offers.length + c.zones.length > 0)
    .sort((a, b) => a.club_name.localeCompare(b.club_name))

  return ok({ migrated, catalog: zonesByClub !== null, clubs })
}

const Create = TableInput.extend({
  club_id: z.string().uuid(),
  name:    z.string().trim().min(1).max(80),
})

// POST — a new table at a venue, optionally with its listings and zones.
export async function POST(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = Create.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid table')
  const { club_id, name, ...rest } = parsed.data

  const sb = await createServiceClient()
  const { data: created, error } = await sb
    .from('club_tables').insert({ club_id, name }).select('*').single()
  if (error) return err(isMissingSchema(error.message) ? MIGRATION_HINT : error.message, isMissingSchema(error.message) ? 503 : 500)

  const res = await writeTable(sb, String(created.id), club_id, rest)
  if (!res.ok) {
    // Don't leave a half-made table behind.
    await sb.from('club_tables').delete().eq('id', created.id)
    return err(res.error, res.status)
  }

  const { data: club } = await sb.from('clubs').select('name').eq('id', club_id).maybeSingle()
  await logAudit(sb, {
    action: 'club.table_create',
    summary: `Created table “${name}” at ${(club as { name?: string } | null)?.name ?? club_id}`,
    target_type: 'club', target_id: club_id,
    meta: { table_id: res.table.id, ...rest },
  })
  return ok(res.table, 201)
}
