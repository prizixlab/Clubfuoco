import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// PATCH /api/portal/events/[id] — pin, unpin, reorder, publish, unpublish.
// DELETE /api/portal/events/[id] — remove a HOUSE event only.
//
// The pin written here is ours. It is not `featured`, which a promoter buys,
// and this route will not set that column: letting the operator flip a paid
// promotion flag by hand would put an unbilled event in the paid slot and make
// the billing table disagree with what shipped.

type Body = {
  /** true → pin, false → unpin. */
  pinned?: boolean
  /** Running order among pins, lowest first. Null clears it. */
  pin_rank?: number | null
  pin_note?: string | null
  is_published?: boolean
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await ctx.params
  const sb = await createServiceClient()

  let body: Body
  try { body = await req.json() } catch { return err('Invalid JSON', 400) }

  const patch: Record<string, unknown> = {}

  if (typeof body.pinned === 'boolean') {
    // Unpinning clears the whole pin, rank and note included. A stale rank left
    // behind would silently decide the order the next time it is pinned.
    patch.pinned_at = body.pinned ? new Date().toISOString() : null
    if (!body.pinned) { patch.pin_rank = null; patch.pin_note = null }
  }

  if (body.pin_rank !== undefined) {
    if (body.pin_rank === null) {
      patch.pin_rank = null
    } else {
      const n = Number(body.pin_rank)
      if (!Number.isInteger(n) || n < 0) return err('Rank must be a whole number, 0 or more', 400)
      patch.pin_rank = n
    }
  }

  if (body.pin_note !== undefined) {
    patch.pin_note = body.pin_note ? String(body.pin_note).trim().slice(0, 280) : null
  }

  if (typeof body.is_published === 'boolean') patch.is_published = body.is_published

  if (Object.keys(patch).length === 0) return err('Nothing to change', 400)

  const { data, error } = await sb
    .from('promoter_nights')
    .update(patch)
    .eq('id', id)
    .select('id, pinned_at, pin_rank, pin_note, is_published')
    .single()

  if (error) return err(error.message, 500)
  if (!data) return err('No such event', 404)
  return ok(data)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await ctx.params
  const sb = await createServiceClient()

  // Only house events are deletable from here. A promoter's night is their
  // record — it has their guest list and their money against it — so the portal
  // unpublishes rather than destroys. Checked before deleting rather than
  // folded into the delete filter so the refusal can say why.
  const { data: row, error: readErr } = await sb
    .from('promoter_nights')
    .select('id, is_house')
    .eq('id', id)
    .single()

  if (readErr) return err(readErr.message, 500)
  if (!row) return err('No such event', 404)
  if (!row.is_house) {
    return err("That is a promoter's event — unpublish it instead of deleting it", 403)
  }

  // Refuse once anyone is on the list: deleting would cascade their rows away,
  // and someone holding a pass would simply find it gone.
  //
  // Guests hang off ALLOCATIONS, not off the night — `promoter_guests` has an
  // `allocation_id` and no `night_id` — so the count has to go through
  // promoter_allocations. Counting the wrong table would always return zero and
  // make this guard silently useless.
  const { data: allocs, error: allocErr } = await sb
    .from('promoter_allocations')
    .select('id')
    .eq('night_id', id)

  if (allocErr) return err(allocErr.message, 500)

  const allocIds = (allocs ?? []).map(a => a.id)
  if (allocIds.length > 0) {
    const { count, error: guestErr } = await sb
      .from('promoter_guests')
      .select('id', { count: 'exact', head: true })
      .in('allocation_id', allocIds)

    if (guestErr) return err(guestErr.message, 500)
    if ((count ?? 0) > 0) {
      return err(`${count} guest${count === 1 ? '' : 's'} already on this list — unpublish it instead`, 409)
    }
  }

  const { error } = await sb.from('promoter_nights').delete().eq('id', id)
  if (error) return err(error.message, 500)
  return ok({ id })
}
