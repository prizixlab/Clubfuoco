import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'

// PATCH /api/promoter-invites/guest/[guestId] — the guest owner updates their
// own plus-ones (declare more/fewer people) after claiming. Enforces the
// night's per-guest cap AND the allocation's remaining capacity.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ guestId: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { guestId } = await params

  const body = await req.json().catch(() => ({}))
  const requested = Number(body.plus_ones)
  if (!Number.isFinite(requested) || requested < 0) return err('plus_ones must be a non-negative number', 400)

  const sb = await createServiceClient()

  // The guest row + its allocation (spots, per-guest cap) + the full roster
  // so we can check capacity.
  const { data: guest } = await sb
    .from('promoter_guests')
    .select(`
      id, plus_ones, claimed_by_user, allocation_id,
      allocation:promoter_allocations (
        id, spots,
        night:promoter_nights ( max_plus_ones ),
        promoter_guests ( id, plus_ones )
      )
    `)
    .eq('id', guestId)
    .single()

  if (!guest) return err('Guest not found', 404)
  if (guest.claimed_by_user !== me) return err('Not your spot', 403)

  const alloc: any = Array.isArray(guest.allocation) ? guest.allocation[0] : guest.allocation
  const nightRow: any = Array.isArray(alloc?.night) ? alloc.night[0] : alloc?.night
  const maxPlus: number | null = nightRow?.max_plus_ones ?? null
  const capped = maxPlus == null ? requested : Math.min(requested, maxPlus)

  // Capacity: everyone's heads EXCEPT this guest's current contribution, then
  // add this guest back with the requested plus-ones.
  const others = (alloc?.promoter_guests ?? []).reduce(
    (s: number, g: { id: string; plus_ones: number }) =>
      s + (g.id === guest.id ? 0 : 1 + (g.plus_ones ?? 0)), 0)
  if (others + 1 + capped > (alloc?.spots ?? 0)) return err('Not enough spots left', 409)

  const { data: updated, error: upErr } = await sb
    .from('promoter_guests')
    .update({ plus_ones: capped })
    .eq('id', guest.id)
    .select('id, full_name, plus_ones')
    .single()
  if (upErr || !updated) return err(upErr?.message ?? 'Could not update', 500)

  return ok({ guest: updated, maxPlusOnes: maxPlus })
}
