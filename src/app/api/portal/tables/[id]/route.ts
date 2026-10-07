import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'
import { TableInput, writeTable } from '../_shared'

const SELLER_LABEL: Record<string, string> = {
  auto: 'every listing shows', offer: 'one of our listings sells it',
  fourvenues: 'Fourvenues sells it', none: 'nobody sells it',
}

// PATCH /api/portal/tables/:id — rename, regroup, or choose the seller.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const parsed = TableInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid patch')
  if (Object.keys(parsed.data).length === 0) return err('Nothing to update')

  const sb = await createServiceClient()
  const { data: existing } = await sb.from('club_tables').select('club_id, name').eq('id', id).maybeSingle()
  if (!existing) return err('Table not found', 404)

  const res = await writeTable(sb, id, String(existing.club_id), parsed.data)
  if (!res.ok) return err(res.error, res.status)

  await logAudit(sb, {
    action: 'club.table_update',
    summary: parsed.data.seller
      ? `Table “${res.table.name}”: ${SELLER_LABEL[res.table.seller]}`
      : `Edited table “${res.table.name}”`,
    target_type: 'club', target_id: String(existing.club_id),
    meta: { table_id: id, ...parsed.data },
  })
  return ok(res.table)
}

// DELETE /api/portal/tables/:id — ungroup. Its listings become products on
// their own again (partner_offers.table_id → null by the FK), which means they
// all show.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()
  const { data: existing } = await sb.from('club_tables').select('club_id, name').eq('id', id).maybeSingle()
  if (!existing) return err('Table not found', 404)
  const { error } = await sb.from('club_tables').delete().eq('id', id)
  if (error) return err(error.message, 500)
  await logAudit(sb, {
    action: 'club.table_delete',
    summary: `Removed table “${existing.name}” — its listings are separate products again`,
    target_type: 'club', target_id: String(existing.club_id), meta: { table_id: id },
  })
  return ok({ id, removed: true })
}
