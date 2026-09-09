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
  /** Replaces the whole billing, in order. */
  lineup?: { id?: string | null; name?: string }[]
  /** Replaces the whole host list, in order. */
  hosts?: { id?: string | null; name?: string }[]
  /** Replaces the whole route, in order. `[]` turns a route back into an
   *  ordinary single-venue night. */
  stops?: unknown[]
}

/// "23:30:00" or "23:30" → "23:30".
function clock(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/^(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : null
}

/// Normalise the route — mirrors the one in ../route.ts.
function route(raw: unknown): { club_id: string | null; name: string; start: string | null; end: string | null; note: string | null }[] {
  if (!Array.isArray(raw)) return []
  const clean = (raw as Record<string, unknown>[])
    .filter(s => s && typeof s.name === 'string' && s.name.trim() !== '')
    .map(s => ({
      club_id: typeof s.club_id === 'string' && s.club_id ? s.club_id : null,
      name: (s.name as string).trim().slice(0, 120),
      start: clock(s.start),
      end: clock(s.end),
      note: typeof s.note === 'string' && s.note.trim() !== '' ? s.note.trim().slice(0, 140) : null,
    }))
    .slice(0, 6)
  return clean.length >= 2 ? clean : []
}

/// Normalise a jsonb [{id, name}] payload — used by both `lineup` and `hosts`.
function credits(raw: unknown): { id: string | null; name: string }[] {
  if (!Array.isArray(raw)) return []
  return (raw as { id?: unknown; name?: unknown }[])
    .filter(c => c && typeof c.name === 'string' && c.name.trim() !== '')
    .map(c => ({ id: c.id == null ? null : String(c.id), name: String(c.name).trim() }))
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

  // Whole-list replaces rather than appends: ORDER is the point in both, and
  // the only way to reorder or remove an entry is to send the new list.
  if (body.lineup !== undefined) patch.lineup = credits(body.lineup).slice(0, 20)
  if (body.hosts !== undefined) patch.hosts = credits(body.hosts).slice(0, 10)

  // Editing the route re-derives the three columns that hang off it, in the
  // same direction as the create path: the night belongs to where it starts,
  // and its span runs from the first stop's start to the last one's end.
  // Writing `stops` without re-deriving would leave the card saying 23:00 at
  // Opium while the route says 22:00 at the beach club.
  if (body.stops !== undefined) {
    const stops = route(body.stops)
    if ((body.stops as unknown[]).length > 0 && stops.length === 0) {
      return err('A route needs at least two stops, each with a name', 400)
    }
    patch.stops = stops
    if (stops.length > 0) {
      const first = stops[0]
      const last = stops[stops.length - 1]
      patch.club_id = first.club_id
      patch.location_name = first.club_id ? null : first.name
      patch.open_time = first.start
      patch.close_time = last.end
    }
    // Clearing a route deliberately leaves club_id/open_time/close_time alone:
    // they are now the only record of where the night is, and blanking them
    // would strand the event with no venue at all.
  }

  if (Object.keys(patch).length === 0) return err('Nothing to change', 400)

  const { data, error } = await sb
    .from('promoter_nights')
    .update(patch)
    .eq('id', id)
    .select('id, pinned_at, pin_rank, pin_note, is_published, lineup, hosts, stops, club_id, open_time, close_time')
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
