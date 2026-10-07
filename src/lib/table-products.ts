// ── VIP tables as products ───────────────────────────────────────────────────
//
// Every VIP table is its own product, whoever sells it and however it is
// booked. See supabase/migrations/20261008_table_products.sql.
//
//   • A listing on its own — one vip_table partner_offers row, or one
//     Fourvenues zone at a club — is a product. It shows; nothing contests it.
//     (Before, club_offer_visibility handed a whole venue's VIP to ONE
//     supplier, and the app hid all of our tables on any night Fourvenues sold
//     one.)
//   • Listings the operator groups into one club_tables row are the SAME
//     table, and the row's `seller` decides who gets the buy button.
//
// Pure where it can be, so the rule is tested without a database. Every read
// tolerates the migration not being applied: no table → no groups → every
// listing is its own product.

import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

export type TableSeller = 'auto' | 'offer' | 'fourvenues' | 'none'
export const TABLE_SELLERS: readonly TableSeller[] = ['auto', 'offer', 'fourvenues', 'none']

/** The one offer kind that is sold per table rather than per venue. */
export const TABLE_KIND = 'vip_table'
export const isTableKind = (kind: unknown) => kind === TABLE_KIND

export interface ClubTable {
  id:               string
  club_id:          string
  name:             string
  /** Normalised Fourvenues zone names that ARE this table (see normZone). */
  fourvenues_zones: string[]
  seller:           TableSeller
  seller_offer_id:  string | null
  sort_order:       number
}

/**
 * A Fourvenues zone's identity at a club. Fourvenues mints a new zone id every
 * night, so the name is the only stable key: lowercase, no accents, single
 * spaces. The iOS app normalises the same way (TableSellers.norm) — keep the
 * two in step.
 */
export function normZone(name: unknown): string {
  return String(name ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

export function toClubTable(r: Record<string, unknown>): ClubTable {
  const seller = TABLE_SELLERS.includes(r.seller as TableSeller) ? r.seller as TableSeller : 'auto'
  return {
    id:               String(r.id),
    club_id:          String(r.club_id),
    name:             String(r.name ?? ''),
    fourvenues_zones: ((r.fourvenues_zones as string[] | null) ?? []).map(normZone).filter(Boolean),
    seller,
    seller_offer_id:  (r.seller_offer_id as string | null) ?? null,
    sort_order:       Number(r.sort_order ?? 0),
  }
}

export type TableMap = Map<string, ClubTable>

/** Every table, by id. Empty when the migration isn't applied. */
export async function loadTables(sb: SB, clubId?: string): Promise<TableMap> {
  try {
    let q = sb.from('club_tables').select('*')
    if (clubId) q = q.eq('club_id', clubId)
    const { data, error } = await q
    if (error) return new Map()
    return new Map(((data ?? []) as Record<string, unknown>[]).map(r => {
      const t = toClubTable(r)
      return [t.id, t]
    }))
  } catch { return new Map() }
}

/**
 * Who actually sells a table right now.
 *
 * An 'offer' decision whose offer is no longer live (archived, its promoter
 * muted, deleted) falls back to 'auto': the operator chose a seller, not to
 * bury the table, and a decision about someone who left is a decision nobody
 * made about the rest. A 'fourvenues' decision stands on its own — whether
 * Fourvenues sells that zone on a given night is the catalog's business.
 */
export function effectiveSeller(
  table: ClubTable, liveOfferIds: Set<string>,
): { seller: TableSeller; offerId: string | null } {
  if (table.seller === 'offer') {
    return table.seller_offer_id && liveOfferIds.has(table.seller_offer_id)
      ? { seller: 'offer', offerId: table.seller_offer_id }
      : { seller: 'auto', offerId: null }
  }
  return { seller: table.seller, offerId: null }
}

/**
 * May this listing of ours show? Only meaningful for vip_table offers.
 *
 * `liveOfferIds` is every offer that would show if tables didn't exist (live,
 * supplier not muted) — the set the 'offer' fallback above is judged against.
 */
export function offerSellsTable(
  offer: { id?: unknown; table_id?: unknown },
  tables: TableMap,
  liveOfferIds: Set<string>,
): boolean {
  const tableId = offer.table_id ? String(offer.table_id) : null
  if (!tableId) return true                     // a product on its own
  const table = tables.get(tableId)
  if (!table) return true                       // dangling link: treat as on its own
  const { seller, offerId } = effectiveSeller(table, liveOfferIds)
  if (seller === 'auto') return true
  if (seller === 'offer') return String(offer.id) === offerId
  return false                                  // 'fourvenues' or 'none'
}

/** May Fourvenues sell this table? (Zones in no table always may.) */
export function fourvenuesSellsTable(table: ClubTable, liveOfferIds: Set<string>): boolean {
  const { seller } = effectiveSeller(table, liveOfferIds)
  return seller === 'auto' || seller === 'fourvenues'
}

/** The per-club decisions /api/partner hands the app. */
export interface PublicTable {
  id:                  string
  name:                string
  seller:              TableSeller      // effective, after the fallback above
  offer_id:            string | null
  fourvenues_zones:    string[]
  /** false = the app must hide these zones from the Fourvenues catalog. */
  fourvenues_on_sale:  boolean
}

export function publicTablesByClub(
  tables: TableMap, liveOfferIds: Set<string>,
): Record<string, PublicTable[]> {
  const out: Record<string, PublicTable[]> = {}
  const sorted = [...tables.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  for (const t of sorted) {
    const { seller, offerId } = effectiveSeller(t, liveOfferIds)
    ;(out[t.club_id] ??= []).push({
      id: t.id,
      name: t.name,
      seller,
      offer_id: offerId,
      fourvenues_zones: t.fourvenues_zones,
      fourvenues_on_sale: seller === 'auto' || seller === 'fourvenues',
    })
  }
  return out
}
