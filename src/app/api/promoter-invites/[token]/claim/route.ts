import { createServiceClient, createClient } from '@/lib/supabase/server'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
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

  if (!fullName) return err('Name is required', 400)

  const sb = await createServiceClient()

  // Identify the claimer from the Bearer token if present. NEVER trust a
  // user id from the request body — that lets a caller attribute a claim to
  // any victim. Anonymous (Instagram webview, no session) claims are allowed
  // and simply have a null claimed_by_user.
  let claimedByUser: string | null = null
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (bearer) {
    // Native app: Bearer token.
    const { data: userResp } = await sb.auth.getUser(bearer)
    claimedByUser = userResp.user?.id ?? null
  } else {
    // Web: cookie session (logged-in Safari). Anonymous webview → stays null.
    const cookieClient = await createClient()
    const { data: { user } } = await cookieClient.auth.getUser()
    claimedByUser = user?.id ?? null
  }

  // Resolve one-off OR permanent series token → the concrete night's allocation.
  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)

  const { data: alloc, error: allocErr } = await sb
    .from('promoter_allocations')
    .select('id, spots, promoter_guests(id, full_name, plus_ones, claimed_by_user)')
    .eq('id', resolved.allocationId)
    .single()

  if (allocErr || !alloc) return err('Invite not found', 404)

  // Dedupe: a logged-in user who re-taps their link gets their existing row
  // back instead of a second claim (which would double-count capacity).
  if (claimedByUser) {
    const existing = (alloc.promoter_guests ?? []).find(
      (g: { claimed_by_user: string | null }) => g.claimed_by_user === claimedByUser)
    if (existing) return ok({ guest: existing, alreadyClaimed: true })
  }

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

  // 23505 = unique_violation from the partial index (race between the dedupe
  // check above and insert). Fetch and return the winning row.
  if (insertErr?.code === '23505' && claimedByUser) {
    const { data: winner } = await sb
      .from('promoter_guests')
      .select('id, full_name, plus_ones')
      .eq('allocation_id', alloc.id)
      .eq('claimed_by_user', claimedByUser)
      .single()
    if (winner) return ok({ guest: winner, alreadyClaimed: true })
  }
  if (insertErr || !guest) return err('Couldn\'t add you to the list', 500)
  return ok({ guest })
}
