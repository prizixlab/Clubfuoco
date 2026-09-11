import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// PATCH /api/portal/featured/:id — move a slot between tiers, reorder it
//   within one, or retitle the note. { tier?: 1|2, rank?: number, note?: string|null }
// DELETE /api/portal/featured/:id — take it off the shelf.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return err('Invalid JSON')

  const patch: Record<string, unknown> = {}
  if (body.tier !== undefined) {
    const tier = Number(body.tier)
    if (tier !== 1 && tier !== 2) return err('tier must be 1 or 2')
    patch.tier = tier
  }
  if (body.rank !== undefined) {
    const rank = Number(body.rank)
    if (!Number.isFinite(rank)) return err('rank must be a number')
    patch.rank = Math.trunc(rank)
  }
  if (body.note !== undefined) {
    patch.note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null
  }
  if (Object.keys(patch).length === 0) return ok({ unchanged: true })
  patch.updated_at = new Date().toISOString()

  const sb = await createServiceClient()

  // Moving between tiers lands at the end of the destination, for the same
  // reason adding does: it must not reorder what is already there.
  if (patch.tier !== undefined && body.rank === undefined) {
    const { data: last } = await sb
      .from('featured_slots')
      .select('rank')
      .eq('tier', patch.tier)
      .order('rank', { ascending: false })
      .limit(1)
    patch.rank = ((last?.[0]?.rank as number) ?? -1) + 1
  }

  const { error } = await sb.from('featured_slots').update(patch).eq('id', id)
  if (error) return err(error.message, 500)

  await logAudit(sb, {
    action: 'featured.update',
    summary: `Featured slot moved${patch.tier ? ` to tier ${patch.tier}` : ''}`,
    target_type: 'featured_slot', target_id: id, meta: patch,
  })
  return ok({ updated: true, ...patch })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params

  const sb = await createServiceClient()
  const { error } = await sb.from('featured_slots').delete().eq('id', id)
  if (error) return err(error.message, 500)

  await logAudit(sb, {
    action: 'featured.remove',
    summary: 'Removed from the featured shelf',
    target_type: 'featured_slot', target_id: id,
  })
  return ok({ removed: true })
}
