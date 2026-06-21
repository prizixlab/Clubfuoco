import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

/**
 * Public claim endpoint for promoter invite links.
 * Anyone with a valid token can claim a spot — we mint a promoter_guests row
 * stamped with `created_via_invite = true`. Service role so anon visitors
 * write past RLS.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const plusOnes = Math.max(0, Math.min(10, Number(body.plus_ones) || 0))
  const claimedByUser = typeof body.claimed_by_user === 'string' ? body.claimed_by_user : null

  if (!fullName) return err('Name is required', 400)

  const sb = await createServiceClient()
  const { data: alloc, error: allocErr } = await sb
    .from('promoter_allocations')
    .select('id, spots, promoter_guests(plus_ones)')
    .eq('invite_token', token)
    .single()

  if (allocErr || !alloc) return err('Invite not found', 404)

  const used = (alloc.promoter_guests ?? []).reduce(
    (s: number, g: { plus_ones: number }) => s + 1 + g.plus_ones, 0)
  if (used + 1 + plusOnes > alloc.spots) return err('Not enough spots left', 409)

  const { data: guest, error: insertErr } = await sb
    .from('promoter_guests')
    .insert({
      allocation_id: alloc.id,
      full_name: fullName,
      plus_ones: plusOnes,
      created_via_invite: true,
      claimed_by_user: claimedByUser,
    })
    .select('id, full_name, plus_ones')
    .single()

  if (insertErr || !guest) return err('Couldn\'t add you to the list', 500)
  return ok({ guest })
}
