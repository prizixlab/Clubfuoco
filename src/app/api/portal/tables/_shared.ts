import { z } from 'zod'
import type { createServiceClient } from '@/lib/supabase/server'
import { normZone, TABLE_SELLERS, toClubTable, type ClubTable } from '@/lib/table-products'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// Shared by /api/portal/tables (create) and /api/portal/tables/[id] (edit).
// One write path, so the invariants hold however a table is touched:
//
//   • a table only holds VIP listings of ITS OWN club;
//   • a Fourvenues zone is ONE table at a club — adding it here takes it out
//     of any other table there, or the same zone would get two answers;
//   • seller 'offer' names a listing in this table — dropping that listing
//     from the table drops the decision back to 'auto';
//   • seller 'fourvenues' needs a zone to sell.

export const MIGRATION_HINT =
  'Tables need a schema change that has not been applied yet — run ' +
  'supabase/migrations/20261008_table_products.sql in the SQL editor.'

export const isMissingSchema = (msg: string | undefined) =>
  /club_tables|table_id|schema cache|does not exist/i.test(msg ?? '')

export const TableInput = z.object({
  name:             z.string().trim().min(1).max(80).optional(),
  seller:           z.enum(TABLE_SELLERS as [string, ...string[]]).optional(),
  seller_offer_id:  z.string().uuid().nullable().optional(),
  offer_ids:        z.array(z.string().uuid()).max(50).optional(),
  fourvenues_zones: z.array(z.string().max(120)).max(50).optional(),
  sort_order:       z.number().int().optional(),
}).strict()
export type TableInput = z.infer<typeof TableInput>

export type WriteResult = { ok: true; table: ClubTable } | { ok: false; error: string; status: number }

/**
 * Apply `input` to table `id` (already created, belonging to `clubId`).
 * Returns the saved row.
 */
export async function writeTable(sb: SB, id: string, clubId: string, input: TableInput): Promise<WriteResult> {
  // Membership first — the seller check below is judged against the result.
  if (input.offer_ids) {
    const ids = [...new Set(input.offer_ids)]
    if (ids.length) {
      const { data: offers, error } = await sb.from('partner_offers').select('id, club_id, kind').in('id', ids)
      if (error) return { ok: false, error: error.message, status: 500 }
      const fit = (offers ?? []).filter(o => o.club_id === clubId && o.kind === 'vip_table')
      if (fit.length !== ids.length) {
        return { ok: false, error: 'A table can only hold VIP listings at its own venue.', status: 400 }
      }
    }
    // Unbind whoever is in the table now, then bind the requested set.
    const off = await sb.from('partner_offers').update({ table_id: null }).eq('table_id', id)
    if (off.error) {
      const missing = isMissingSchema(off.error.message)
      return { ok: false, error: missing ? MIGRATION_HINT : off.error.message, status: missing ? 503 : 500 }
    }
    if (ids.length) {
      const on = await sb.from('partner_offers').update({ table_id: id }).in('id', ids)
      if (on.error) return { ok: false, error: on.error.message, status: 500 }
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) patch.name = input.name
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order

  if (input.fourvenues_zones) {
    const zones = [...new Set(input.fourvenues_zones.map(normZone).filter(Boolean))]
    patch.fourvenues_zones = zones
    // Take these zones out of every other table at this venue.
    if (zones.length) {
      const { data: others } = await sb.from('club_tables').select('*').eq('club_id', clubId).neq('id', id)
      for (const raw of (others ?? []) as Record<string, unknown>[]) {
        const o = toClubTable(raw)
        const kept = o.fourvenues_zones.filter(z => !zones.includes(z))
        if (kept.length === o.fourvenues_zones.length) continue
        await sb.from('club_tables').update({
          fourvenues_zones: kept,
          // Lost its last zone: a Fourvenues decision has nothing left to sell.
          ...(o.seller === 'fourvenues' && kept.length === 0 ? { seller: 'auto' } : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', o.id)
      }
    }
  }

  // The seller, checked against the table as it will be after this write.
  const { data: current } = await sb.from('club_tables').select('*').eq('id', id).maybeSingle()
  if (!current) return { ok: false, error: 'Table not found', status: 404 }
  const before = toClubTable(current as Record<string, unknown>)
  const { data: members } = await sb.from('partner_offers').select('id').eq('table_id', id)
  const memberIds = new Set((members ?? []).map(m => String(m.id)))
  const zonesAfter = (patch.fourvenues_zones as string[] | undefined) ?? before.fourvenues_zones

  let seller = input.seller ?? before.seller
  let sellerOffer = input.seller_offer_id !== undefined ? input.seller_offer_id : before.seller_offer_id
  if (seller === 'offer') {
    if (!sellerOffer || !memberIds.has(sellerOffer)) {
      if (input.seller === 'offer') {
        return { ok: false, error: 'Pick one of this table’s own listings to sell it.', status: 400 }
      }
      // The chosen listing left the table — nobody decided the rest, so 'auto'.
      seller = 'auto'; sellerOffer = null
    }
  } else {
    sellerOffer = null
  }
  if (seller === 'fourvenues' && zonesAfter.length === 0) {
    if (input.seller === 'fourvenues') {
      return { ok: false, error: 'Link a Fourvenues zone to this table first.', status: 400 }
    }
    seller = 'auto'
  }
  patch.seller = seller
  patch.seller_offer_id = sellerOffer

  const { data: saved, error } = await sb.from('club_tables').update(patch).eq('id', id).select('*').single()
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true, table: toClubTable(saved as Record<string, unknown>) }
}
